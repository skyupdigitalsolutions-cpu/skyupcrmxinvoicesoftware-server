import http from "http";
const req = http.get("http://127.0.0.1:5000/api/health", (res) => {
  console.log("STATUS:", res.statusCode);
  console.log("HEADERS:", JSON.stringify(res.headers));
  res.on("data", d => process.stdout.write(d));
}).on("error", (e) => {
  console.error("ERROR:", e.message, e.code);
});
