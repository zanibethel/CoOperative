const baseUrl =
  process.env.COOPERATIVE_BASE_URL?.replace(/\/$/, "") ||
  "http://localhost:3000";
const secret = process.env.COOPERATIVE_INFERENCE_SHARED_SECRET?.trim();

if (!secret) {
  console.error(
    "COOPERATIVE_INFERENCE_SHARED_SECRET is required to run the model capability scanner.",
  );
  process.exit(1);
}

const response = await fetch(`${baseUrl}/api/inference/models/scan`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  },
});

const text = await response.text();
let payload;
try {
  payload = text ? JSON.parse(text) : null;
} catch {
  payload = { raw: text };
}

if (!response.ok) {
  console.error(
    JSON.stringify(
      {
        status: response.status,
        payload,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

console.log(JSON.stringify(payload, null, 2));
