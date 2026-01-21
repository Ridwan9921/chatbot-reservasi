import Groq from "groq-sdk";
import { createClient } from "@supabase/supabase-js";

/* =========================
   INIT CLIENT
========================= */
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

/* =========================
   SYSTEM PROMPT
========================= */
const SYSTEM_PROMPT = `
Anda adalah asisten virtual untuk Restoran WAJIB yang bertugas membantu pelanggan membuat reservasi meja.

ATURAN WAJIB:
- Tanyakan informasi secara BERURUTAN, satu per satu
- TIDAK BOLEH melompat ke pertanyaan berikutnya sebelum pertanyaan sebelumnya dijawab
- Validasi setiap input
- Gunakan Bahasa Indonesia yang sopan dan natural

URUTAN INFORMASI:
1. Tanggal reservasi (harus di masa depan)
2. Jam reservasi (10.00 - 22.00 WIB)
3. Jumlah orang (1 - 20)
4. Nama pemesan
5. Nomor kontak (08xx / 62xx)

ALUR:
- Sambut pelanggan
- Tanyakan tanggal → jam → jumlah orang → nama → nomor kontak
- Buat ringkasan dan minta konfirmasi
- Jika disetujui, nyatakan reservasi berhasil
- Ucapkan terima kasih

LARANGAN:
- Jangan menanyakan semua pertanyaan sekaligus
- Jangan membuat asumsi
- Jangan melanjutkan jika informasi belum lengkap
`;

/* =========================
   HANDLER (SERVERLESS)
========================= */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {
    const { sessionId, message } = req.body;

    if (!sessionId || !message) {
      return res.status(400).json({
        reply: "Pesan tidak valid. Silakan coba lagi.",
      });
    }

    /* =========================
       AMBIL RIWAYAT CHAT
    ========================= */
    const { data: history } = await supabase
      .from("conversation_logs")
      .select("role, content")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...(history || []),
      { role: "user", content: message },
    ];

    /* =========================
       PANGGIL GROQ AI
    ========================= */
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.6,
      max_tokens: 400,
    });

    const reply = completion.choices[0].message.content;

    /* =========================
       SIMPAN KE SUPABASE
    ========================= */
    await supabase.from("conversation_logs").insert([
      { session_id: sessionId, role: "user", content: message },
      { session_id: sessionId, role: "assistant", content: reply },
    ]);

    return res.status(200).json({ reply });

  } catch (error) {
    console.error("CHAT ERROR:", error);
    return res.status(500).json({
      reply: "Terjadi kesalahan sistem. Silakan coba lagi.",
    });
  }
}
