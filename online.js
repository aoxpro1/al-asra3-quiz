"use strict";

const { spawn, exec } = require("child_process");
const path = require("path");

// 1. Force port 3000 and IPv4
process.env.PORT = "3000";
process.env.HOST = "0.0.0.0";

// 2. Start the Express + Socket.IO server directly
console.log("\n=======================================================");
console.log("   الأسرع | جاري تشغيل اللعبة ونفق Cloudflare الآمن...");
console.log("=======================================================\n");

require("./server.js");

// 3. Start cloudflared tunnel
const cloudflaredExe = path.join(__dirname, "cloudflared.exe");
const tunnel = spawn(cloudflaredExe, ["tunnel", "--url", "http://127.0.0.1:3000"], {
  windowsHide: false,
});

let found = false;

function onData(chunk) {
  const text = chunk.toString();
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (match && !found) {
    found = true;
    const url = match[0];
    console.log("\n=======================================================");
    console.log("   🎉 تم إنشاء رابط اللعبة بنجاح وهو يعمل الآن!");
    console.log("=======================================================");
    console.log(`\n   🌐 الرابط العام:   ${url}`);
    console.log(`   🖥️ شاشة العرض:     ${url}/display`);
    console.log(`   ⚙️ لوحة المشرف:    ${url}/admin  (admin / 9828)`);
    console.log(`   📱 دخول اللاعبين:  ${url}/play`);
    console.log("\n=======================================================");
    console.log("   جاري فتح شاشة العرض في المتصفح تلقائياً...");
    console.log("   (لإيقاف اللعبة في أي وقت: أغلق هذه النافذة)");
    console.log("=======================================================\n");

    // Automatically open in browser
    exec(`start "" "${url}/display"`);
  }
}

tunnel.stderr.on("data", onData);
tunnel.stdout.on("data", onData);

tunnel.on("error", (err) => {
  console.error("خطأ في تشغيل cloudflared:", err.message);
});

tunnel.on("exit", (code) => {
  console.log(`تم إيقاف نفق Cloudflare (${code}).`);
  process.exit(0);
});

process.on("SIGINT", () => {
  tunnel.kill();
  process.exit(0);
});
