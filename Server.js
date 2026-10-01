export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // --------------------------------------------------
    // CORS
    // --------------------------------------------------
    const corsHeaders = {
      "Access-Control-Allow-Origin": url.origin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Credentials": "true",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: corsHeaders
      });

    // --------------------------------------------------
    // DATABASE SETUP
    // --------------------------------------------------
    async function setupDatabase() {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          price REAL NOT NULL DEFAULT 0,
          image TEXT DEFAULT '',
          description TEXT DEFAULT '',
          stock INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();

      // Add order status if old orders table doesn't have it
      try {
        await env.DB.prepare(
          "SELECT status FROM orders LIMIT 1"
        ).all();
      } catch (e) {
        try {
          await env.DB.prepare(`
            ALTER TABLE orders
            ADD COLUMN status TEXT DEFAULT 'New Order'
          `).run();
        } catch (alterError) {
          // Ignore if column was created by another request
        }
      }
    }

    // Make sure required tables/columns exist
    try {
      await setupDatabase();
    } catch (error) {
      return json({
        success: false,
        error: "Database setup failed"
      }, 500);
    }

    // --------------------------------------------------
    // PASSWORD / AUTH HELPERS
    // --------------------------------------------------

    const ADMIN_USERNAME = "admin";

    function getCookie(name) {
      const cookie = request.headers.get("Cookie") || "";

      const parts = cookie.split(";");

      for (const part of parts) {
        const item = part.trim();

        if (item.startsWith(name + "=")) {
          return decodeURIComponent(
            item.substring(name.length + 1)
          );
        }
      }

      return null;
    }

    function base64url(bytes) {
      let binary = "";

      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }

      return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    }

    function base64urlString(str) {
      return btoa(unescape(encodeURIComponent(str)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    }

    function decodeBase64url(str) {
      str = str
        .replace(/-/g, "+")
        .replace(/_/g, "/");

      while (str.length % 4) {
        str += "=";
      }

      return decodeURIComponent(
        escape(atob(str))
      );
    }

    async function createSignature(value) {
      const secret = env.ADMIN_PASSWORD;

      if (!secret) {
        throw new Error("ADMIN_PASSWORD secret is missing");
      }

      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        {
          name: "HMAC",
          hash: "SHA-256"
        },
        false,
        ["sign"]
      );

      const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(value)
      );

      return base64url(new Uint8Array(signature));
    }

    async function createSession() {
      const payload = {
        username: ADMIN_USERNAME,
        expires: Date.now() + (12 * 60 * 60 * 1000)
      };

      const value = base64urlString(
        JSON.stringify(payload)
      );

      const signature = await createSignature(value);

      return value + "." + signature;
    }

    async function verifySession() {
      const session = getCookie("asif_admin_session");

      if (!session) {
        return false;
      }

      const parts = session.split(".");

      if (parts.length !== 2) {
        return false;
      }

      const value = parts[0];
      const suppliedSignature = parts[1];

      const expectedSignature =
        await createSignature(value);

      if (suppliedSignature !== expectedSignature) {
        return false;
      }

      try {
        const payload = JSON.parse(
          decodeBase64url(value)
        );

        if (
          payload.username !== ADMIN_USERNAME ||
          Number(payload.expires) < Date.now()
        ) {
          return false;
        }

        return true;
      } catch (error) {
        return false;
      }
    }

    async function requireAdmin() {
      return await verifySession();
    }

    // --------------------------------------------------
    // BASIC TEST
    // --------------------------------------------------

    if (url.pathname === "/api/test") {
      return json({
        success: true,
        message: "Asif Store Backend is working!"
      });
    }

    // --------------------------------------------------
    // ADMIN LOGIN
    // --------------------------------------------------

    if (
      url.pathname === "/api/admin/login" &&
      request.method === "POST"
    ) {
      try {
        const data = await request.json();

        const username =
          String(data.username || "").trim();

        const password =
          String(data.password || "");

        if (
          username !== ADMIN_USERNAME ||
          !env.ADMIN_PASSWORD ||
          password !== env.ADMIN_PASSWORD
        ) {
          return json({
            success: false,
            message: "Invalid username or password"
          }, 401);
        }

        const session = await createSession();

        return new Response(
          JSON.stringify({
            success: true,
            message: "Login successful"
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              "Set-Cookie":
                `asif_admin_session=${encodeURIComponent(session)}; ` +
                `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`
            }
          }
        );

      } catch (error) {
        return json({
          success: false,
          message: "Login failed"
        }, 500);
      }
    }

    // --------------------------------------------------
    // ADMIN LOGOUT
    // --------------------------------------------------

    if (
      url.pathname === "/api/admin/logout" &&
      request.method === "POST"
    ) {
      return new Response(
        JSON.stringify({
          success: true
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Set-Cookie":
              "asif_admin_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
          }
        }
      );
    }

    // --------------------------------------------------
    // CHECK LOGIN
    // --------------------------------------------------

    if (
      url.pathname === "/api/admin/me" &&
      request.method === "GET"
    ) {
      const loggedIn = await verifySession();

      return json({
        success: true,
        loggedIn
      });
    }

    // --------------------------------------------------
    // PUBLIC PRODUCTS
    // --------------------------------------------------

    if (
      url.pathname === "/api/products" &&
      request.method === "GET"
    ) {
      try {
        const result = await env.DB.prepare(`
          SELECT
            id,
            name,
            price,
            image,
            description,
            stock,
            created_at
          FROM products
          ORDER BY id DESC
        `).all();

        return json({
          success: true,
          products: result.results || []
        });

      } catch (error) {
        return json({
          success: false,
          error: "Unable to load products"
        }, 500);
      }
    }

    // --------------------------------------------------
    // SINGLE PRODUCT
    // --------------------------------------------------

    const productMatch =
      url.pathname.match(/^\/api\/products\/(\d+)$/);

    if (
      productMatch &&
      request.method === "GET"
    ) {
      const productId =
        Number(productMatch[1]);

      try {
        const product =
          await env.DB.prepare(`
            SELECT
              id,
              name,
              price,
              image,
              description,
              stock,
              created_at
            FROM products
            WHERE id = ?
          `)
          .bind(productId)
          .first();

        if (!product) {
          return json({
            success: false,
            message: "Product not found"
          }, 404);
        }

        return json({
          success: true,
          product
        });

      } catch (error) {
        return json({
          success: false,
          error: "Unable to load product"
        }, 500);
      }
    }

    // --------------------------------------------------
    // CUSTOMER ORDER
    // --------------------------------------------------

    if (
      url.pathname === "/api/order" &&
      request.method === "POST"
    ) {
      try {
        const data = await request.json();

        const name =
          String(data.name || "").trim();

        const phone =
          String(data.phone || "").trim();

        const address =
          String(data.address || "").trim();

        const items =
          Array.isArray(data.items)
            ? data.items
            : [];

        const total =
          Number(data.total || 0);

        if (!name || !phone || !address) {
          return json({
            success: false,
            message:
              "Name, phone and address are required"
          }, 400);
        }

        const orderNumber =
          "ASIF-" + Date.now();

        await env.DB.prepare(`
          INSERT INTO orders
          (
            order_number,
            customer_name,
            customer_phone,
            customer_address,
            items,
            total,
            status
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          orderNumber,
          name,
          phone,
          address,
          JSON.stringify(items),
          total,
          "New Order"
        )
        .run();

        return json({
          success: true,
          orderNumber,
          message:
            "Order saved successfully!"
        });

      } catch (error) {
        return json({
          success: false,
          message: "Order save failed"
        }, 500);
      }
    }

    // --------------------------------------------------
    // ADMIN ORDERS
    // --------------------------------------------------

    if (
      url.pathname === "/api/admin/orders" &&
      request.method === "GET"
    ) {
      if (!(await requireAdmin())) {
        return json({
          success: false,
          message: "Unauthorized"
        }, 401);
      }

      try {
        const result = await env.DB.prepare(`
          SELECT
            id,
            order_number,
            customer_name,
            customer_phone,
            customer_address,
            items,
            total,
            status,
            created_at
          FROM orders
          ORDER BY id DESC
        `).all();

        return json({
          success: true,
          orders: result.results || []
        });

      } catch (error) {
        return json({
          success: false,
          error: "Unable to load orders"
        }, 500);
      }
    }

    // --------------------------------------------------
    // ADMIN UPDATE ORDER STATUS
    // --------------------------------------------------

    const orderStatusMatch =
      url.pathname.match(
        /^\/api\/admin\/orders\/(\d+)\/status$/
      );

    if (
      orderStatusMatch &&
      request.method === "PUT"
    ) {
      if (!(await requireAdmin())) {
        return json({
          success: false,
          message: "Unauthorized"
        }, 401);
      }

      const orderId =
        Number(orderStatusMatch[1]);

      try {
        const data = await request.json();

        const allowedStatuses = [
          "New Order",
          "Confirmed",
          "Processing",
          "Shipped",
          "Delivered",
          "Cancelled"
        ];

        const status =
          String(data.status || "");

        if (!allowedStatuses.includes(status)) {
          return json({
            success: false,
            message: "Invalid order status"
          }, 400);
        }

        await env.DB.prepare(`
          UPDATE orders
          SET status = ?
          WHERE id = ?
        `)
        .bind(status, orderId)
        .run();

        return json({
          success: true,
          message: "Order status updated"
        });

      } catch (error) {
        return json({
          success: false,
          message: "Status update failed"
        }, 500);
      }
    }

    // --------------------------------------------------
    // ADMIN PRODUCTS - ADD
    // --------------------------------------------------

    if (
      url.pathname === "/api/admin/products" &&
      request.method === "POST"
    ) {
      if (!(await requireAdmin())) {
        return json({
          success: false,
          message: "Unauthorized"
        }, 401);
      }

      try {
        const data = await request.json();

        const name =
          String(data.name || "").trim();

        const price =
          Number(data.price || 0);

        const image =
          String(data.image || "").trim();

        const description =
          String(data.description || "").trim();

        const stock =
          Number(data.stock || 0);

        if (!name || price < 0) {
          return json({
            success: false,
            message:
              "Product name and valid price are required"
          }, 400);
        }

        const result =
          await env.DB.prepare(`
            INSERT INTO products
            (
              name,
              price,
              image,
              description,
              stock
            )
            VALUES (?, ?, ?, ?, ?)
          `)
          .bind(
            name,
            price,
            image,
            description,
            stock
          )
          .run();

        return json({
          success: true,
          message: "Product added successfully",
          id: result.meta?.last_row_id || null
        });

      } catch (error) {
        return json({
          success: false,
          message: "Product could not be added"
        }, 500);
      }
    }

    // --------------------------------------------------
    // ADMIN PRODUCTS - EDIT
    // --------------------------------------------------

    const adminProductMatch =
      url.pathname.match(
        /^\/api\/admin\/products\/(\d+)$/
      );

    if (
      adminProductMatch &&
      request.method === "PUT"
    ) {
      if (!(await requireAdmin())) {
        return json({
          success: false,
          message: "Unauthorized"
        }, 401);
      }

      const productId =
        Number(adminProductMatch[1]);

      try {
        const data = await request.json();

        const name =
          String(data.name || "").trim();

        const price =
          Number(data.price || 0);

        const image =
          String(data.image || "").trim();

        const description =
          String(data.description || "").trim();

        const stock =
          Number(data.stock || 0);

        await env.DB.prepare(`
          UPDATE products
          SET
            name = ?,
            price = ?,
            image = ?,
            description = ?,
            stock = ?
          WHERE id = ?
        `)
        .bind(
          name,
          price,
          image,
          description,
          stock,
          productId
        )
        .run();

        return json({
          success: true,
          message: "Product updated successfully"
        });

      } catch (error) {
        return json({
          success: false,
          message: "Product update failed"
        }, 500);
      }
    }

    // --------------------------------------------------
    // ADMIN PRODUCTS - DELETE
    // --------------------------------------------------

    if (
      adminProductMatch &&
      request.method === "DELETE"
    ) {
      if (!(await requireAdmin())) {
        return json({
          success: false,
          message: "Unauthorized"
        }, 401);
      }

      const productId =
        Number(adminProductMatch[1]);

      try {
        await env.DB.prepare(`
          DELETE FROM products
          WHERE id = ?
        `)
        .bind(productId)
        .run();

        return json({
          success: true,
          message: "Product deleted successfully"
        });

      } catch (error) {
        return json({
          success: false,
          message: "Product delete failed"
        }, 500);
      }
    }

    // --------------------------------------------------
    // ADMIN DASHBOARD / SALES
    // --------------------------------------------------

    if (
      url.pathname === "/api/admin/dashboard" &&
      request.method === "GET"
    ) {
      if (!(await requireAdmin())) {
        return json({
          success: false,
          message: "Unauthorized"
        }, 401);
      }

      try {
        const products =
          await env.DB.prepare(`
            SELECT COUNT(*) AS total
            FROM products
          `).first();

        const orders =
          await env.DB.prepare(`
            SELECT COUNT(*) AS total
            FROM orders
          `).first();

        const pending =
          await env.DB.prepare(`
            SELECT COUNT(*) AS total
            FROM orders
            WHERE status IN (
              'New Order',
              'Confirmed',
              'Processing',
              'Shipped'
            )
          `).first();

        const sales =
          await env.DB.prepare(`
            SELECT COALESCE(SUM(total), 0) AS total
            FROM orders
            WHERE status != 'Cancelled'
          `).first();

        const todaySales =
          await env.DB.prepare(`
            SELECT COALESCE(SUM(total), 0) AS total
            FROM orders
            WHERE status != 'Cancelled'
            AND date(created_at) = date('now')
          `).first();

        return json({
          success: true,
          dashboard: {
            totalProducts:
              Number(products?.total || 0),

            totalOrders:
              Number(orders?.total || 0),

            pendingOrders:
              Number(pending?.total || 0),

            totalSales:
              Number(sales?.total || 0),

            todaySales:
              Number(todaySales?.total || 0)
          }
        });

      } catch (error) {
        return json({
          success: false,
          message: "Dashboard data unavailable"
        }, 500);
      }
    }

    // --------------------------------------------------
    // DEFAULT
    // --------------------------------------------------

    return json({
      success: true,
      message: "Asif Store Backend is working!"
    });
  }
};
