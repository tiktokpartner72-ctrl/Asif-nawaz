export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // BACKEND TEST
    // =========================
    if (url.pathname === "/api/test") {
      return Response.json({
        success: true,
        message: "Asif Store Backend is working!"
      });
    }

    // =========================
    // DATABASE READ TEST
    // =========================
    if (url.pathname === "/api/db-test") {
      try {
        const result = await env.DB.prepare(
          "SELECT COUNT(*) AS total_orders FROM orders"
        ).first();

        return Response.json({
          success: true,
          database: "asif-store-db",
          total_orders: result?.total_orders ?? 0
        });
      } catch (error) {
        return Response.json(
          {
            success: false,
            error: error.message
          },
          { status: 500 }
        );
      }
    }

    // =========================
    // DIRECT DATABASE WRITE TEST
    // =========================
    if (url.pathname === "/api/db-write-test") {
      try {
        const orderNumber = "TEST-" + Date.now();

        const result = await env.DB.prepare(`
          INSERT INTO orders
          (
            order_number,
            customer_name,
            customer_phone,
            customer_address,
            items,
            total
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `)
          .bind(
            orderNumber,
            "Test Customer",
            "0000",
            "Test Address",
            "[]",
            1
          )
          .run();

        return Response.json({
          success: true,
          message: "D1 write successful!",
          database: "asif-store-db",
          orderNumber: orderNumber,
          changes: result.meta?.changes ?? 0
        });
      } catch (error) {
        return Response.json(
          {
            success: false,
            message: "D1 write failed",
            error: error.message
          },
          { status: 500 }
        );
      }
    }

    // =========================
    // CREATE CUSTOMER ORDER
    // =========================
    if (url.pathname === "/api/order" && request.method === "POST") {
      try {
        const data = await request.json();

        const orderNumber = "ASIF-" + Date.now();

        await env.DB.prepare(`
          INSERT INTO orders
          (
            order_number,
            customer_name,
            customer_phone,
            customer_address,
            items,
            total
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `)
          .bind(
            orderNumber,
            data.name || "",
            data.phone || "",
            data.address || "",
            JSON.stringify(data.items || []),
            Number(data.total || 0)
          )
          .run();

        return Response.json({
          success: true,
          orderNumber: orderNumber,
          message: "Order saved successfully!"
        });
      } catch (error) {
        return Response.json(
          {
            success: false,
            message: "Order save failed",
            error: error.message
          },
          { status: 500 }
        );
      }
    }

    // =========================
    // DEFAULT RESPONSE
    // =========================
    return Response.json({
      success: true,
      message: "Asif Store Backend is working!"
    });
  }
};
