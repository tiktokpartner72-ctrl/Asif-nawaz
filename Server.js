export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Backend test
    if (url.pathname === "/api/test") {
      return Response.json({
        success: true,
        message: "Asif Store Backend is working!"
      });
    }

    // Create order
    if (url.pathname === "/api/order" && request.method === "POST") {
      try {
        const data = await request.json();

        const orderNumber = "AS-" + Date.now();

        await env.DB.prepare(`
          INSERT INTO orders
          (order_number, customer_name, customer_phone, customer_address, items, total)
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

    return Response.json({
      success: true,
      message: "Asif Store Backend is working!"
    });
  }
};