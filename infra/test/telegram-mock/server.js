const http = require("node:http");

const bot = {
  id: 1234567890,
  is_bot: true,
  first_name: "Clean Pay Dev Bot",
  username: "clean_pay_dev_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: true,
};

function resultFor(method) {
  if (method.startsWith("send")) {
    return {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: {
        id: 1,
        type: "private",
        first_name: "Dev User",
      },
      text: "ok",
      from: bot,
    };
  }

  switch (method) {
    case "getMe":
      return bot;
    case "getWebhookInfo":
      return {
        url: "",
        has_custom_certificate: false,
        pending_update_count: 0,
      };
    case "setWebhook":
    case "deleteWebhook":
    case "setMyCommands":
      return true;
    case "getMyName":
      return { name: bot.first_name };
    case "getChatMember":
      return {
        status: "member",
        user: {
          id: 1,
          is_bot: false,
          first_name: "Dev User",
        },
      };
    default:
      return true;
  }
}

const server = http.createServer((req, res) => {
  const match = req.url.match(/^\/bot[^/]+\/([^/?]+)/);
  const method = match?.[1] ?? "unknown";

  req.resume();
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, result: resultFor(method) }));
});

server.listen(8080, "0.0.0.0", () => {
  console.log("Telegram mock listening on 0.0.0.0:8080");
});
