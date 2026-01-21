require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const Groq = require("groq-sdk");

const app = express();
app.use(cors());
app.use(express.json());

// ================== INIT ==================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// ================== SESSION ==================
const sessions = {};

// ================== PROMPT ==================
const SYSTEM_PROMPT = `
Anda adalah asisten reservasi Restoran WAJIB.
Tugas Anda adalah menyampaikan pesan sistem dengan bahasa Indonesia yang ramah,
natural, singkat, dan sopan. Jangan mengubah alur.
`;

// ================== UTIL ==================
const isFutureDate = (text) => text.length > 3; // sederhana, bisa dikembangkan
const isValidTime = (t) => {
  const n = parseInt(t.replace(/\D/g, ""));
  return n >= 10 && n <= 22;
};
const isValidGuests = (g) => {
  const n = parseInt(g);
  return n >= 1 && n <= 20;
};
const isValidPhone = (p) => /^(08|62)\d{8,13}$/.test(p);

const aiSay = async (text) => {
  const r = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "assistant", content: text },
    ],
    temperature: 0.4,
    max_tokens: 300,
  });
  return r.choices[0].message.content;
};

// ================== ROUTES ==================
app.get("/", (_, res) => {
  res.json({ status: "OK", message: "API running" });
});

app.post("/api/chat", async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) {
    return res.status(400).json({ success: false });
  }

  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      step: "ASK_DATE",
      data: {},
    };
  }

  const s = sessions[sessionId];
  let reply = "";

  switch (s.step) {
    case "ASK_DATE":
      reply =
        "Selamat datang di Restoran WAJIB! 👋\nKapan Anda ingin melakukan reservasi? Silakan sebutkan tanggal dan harinya.";
      s.step = "VALIDATE_DATE";
      break;

    case "VALIDATE_DATE":
      if (!isFutureDate(message)) {
        reply =
          "Maaf, tanggal tersebut tidak valid atau sudah lewat. Silakan masukkan tanggal di masa depan.";
      } else {
        s.data.date = message;
        s.step = "ASK_TIME";
        reply =
          "Baik 👍 Jam berapa Anda ingin reservasi?\nJam operasional kami 10.00 – 22.00 WIB.";
      }
      break;

    case "ASK_TIME":
      if (!isValidTime(message)) {
        reply =
          "Maaf, jam tersebut di luar jam operasional. Silakan pilih antara 10.00 – 22.00 WIB.";
      } else {
        s.data.time = message;
        s.step = "ASK_GUESTS";
        reply = "Reservasi untuk berapa orang?";
      }
      break;

    case "ASK_GUESTS":
      if (!isValidGuests(message)) {
        reply =
          "Maaf, jumlah orang harus antara 1 hingga 20 orang.";
      } else {
        s.data.guests = message;
        s.step = "ASK_NAME";
        reply = "Baik. Boleh saya tahu nama Anda?";
      }
      break;

    case "ASK_NAME":
      s.data.name = message;
      s.step = "ASK_CONTACT";
      reply = "Terima kasih. Nomor kontak yang bisa dihubungi?";
      break;

    case "ASK_CONTACT":
      if (!isValidPhone(message)) {
        reply =
          "Mohon masukkan nomor yang valid (08xx atau 62xx).";
      } else {
        s.data.phone = message;
        s.step = "SUMMARY";
        reply = `
Baik, izinkan saya konfirmasi:

📅 Tanggal: ${s.data.date}
🕐 Jam: ${s.data.time}
👥 Jumlah: ${s.data.guests}
📝 Nama: ${s.data.name}
📱 Kontak: ${s.data.phone}

Apakah semua informasi sudah benar?
        `;
      }
      break;

    case "SUMMARY":
      if (/ya|benar|betul|iya/i.test(message)) {
        await supabase.from("reservations").insert({
          customer_name: s.data.name,
          phone: s.data.phone,
          reservation_date: s.data.date,
          reservation_time: s.data.time,
          guest_count: s.data.guests,
          status: "confirmed",
        });
        reply =
          "Reservasi Anda berhasil 🎉\nKami tunggu kedatangan Anda di Restoran WAJIB.\nTerima kasih!";
        delete sessions[sessionId];
      } else {
        s.step = "ASK_DATE";
        reply = "Baik, mari kita mulai kembali dari tanggal reservasi.";
      }
      break;
  }

  res.json({
    success: true,
    message: await aiSay(reply),
  });
});

module.exports = app;
