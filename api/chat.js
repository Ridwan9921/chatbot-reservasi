import { createClient } from '@supabase/supabase-js';
import Groq from 'groq-sdk';

// ==========================
// INIT CLIENT
// ==========================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// ==========================
// SYSTEM PROMPT
// ==========================
const SYSTEM_PROMPT = `Anda adalah asisten virtual untuk Restoran WAJIB yang bertugas membantu pelanggan membuat reservasi meja. Anda harus bersikap ramah, sopan, dan profesional dalam Bahasa Indonesia.

PERAN ANDA:
- Agen reservasi restoran yang membantu pelanggan memesan meja
- Mengumpulkan informasi reservasi secara lengkap dan akurat
- Memberikan pengalaman percakapan yang natural dan menyenangkan

ATURAN WAJIB:
1. Tanyakan informasi secara BERURUTAN, satu per satu
2. TIDAK BOLEH melompat ke pertanyaan berikutnya sebelum pertanyaan sebelumnya dijawab dengan lengkap
3. Validasi setiap input yang diberikan pelanggan
4. Gunakan bahasa yang sopan dan natural (Bahasa Indonesia)
5. Jika pelanggan memberikan informasi yang tidak valid, minta dengan sopan untuk memberikan informasi yang benar
6. Jangan membuat asumsi - selalu minta konfirmasi jika ada yang tidak jelas

INFORMASI YANG HARUS DIKUMPULKAN (BERURUTAN):
1. Tanggal dan hari reservasi
2. Jam reservasi (jam operasional: 10.00 - 22.00 WIB)
3. Jumlah orang (kapasitas: 1-20 orang)
4. Nama pemesan
5. Nomor kontak yang dapat dihubungi

VALIDASI:
- Tanggal: Harus tanggal di masa depan
- Jam: Harus dalam rentang 10.00 - 22.00 WIB
- Jumlah orang: Harus angka antara 1-20
- Nomor kontak: Harus format nomor telepon yang valid (08xx atau 62xx)

ALUR PERCAKAPAN:
1. Sambut pelanggan dengan ramah
2. Tanyakan tanggal dan hari → tunggu jawaban → validasi
3. Tanyakan jam reservasi → tunggu jawaban → validasi
4. Tanyakan jumlah orang → tunggu jawaban → validasi
5. Tanyakan nama pemesan → tunggu jawaban
6. Tanyakan nomor kontak → tunggu jawaban → validasi
7. Buat ringkasan semua informasi dan minta konfirmasi
8. Jika disetujui, berikan kode reservasi dan ucapkan terima kasih`;

// ==========================
// IN-MEMORY SESSION
// ==========================
const sessions = {};

// ==========================
// HELPERS
// ==========================
function generateReservationCode() {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0');
  return 'RES' + timestamp.slice(-8) + random;
}

function extractReservationData(conversation) {
  const data = {
    date: null,
    time: null,
    guests: null,
    name: null,
    phone: null
  };

  const messages = conversation.messages || [];

  for (const msg of messages) {
    if (msg.role !== 'user') continue;

    const content = msg.content.toLowerCase();

    // Phone
    const phoneMatch = content.match(/\b(08\d{8,11}|628\d{8,11}|\+628\d{8,11})\b/);
    if (phoneMatch && !data.phone) {
      data.phone = phoneMatch[0];
    }

    // Guest count
    const guestMatch = content.match(/\b(\d+)\s*(orang|org|pax|people)\b/i);
    if (guestMatch && !data.guests) {
      data.guests = parseInt(guestMatch[1]);
    }

    // Name heuristic
    if (!data.name && content.length < 40 && !content.match(/\d/)) {
      data.name = content.trim();
    }
  }

  return data;
}

// ==========================
// API HANDLER (VERCEL)
// ==========================
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: 'Method tidak diizinkan'
    });
  }

  try {
    const { sessionId, message } = req.body;

    if (!sessionId || !message) {
      return res.status(400).json({
        success: false,
        message: 'sessionId dan message wajib diisi'
      });
    }

    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        messages: [],
        isComplete: false
      };
    }

    sessions[sessionId].messages.push({
      role: 'user',
      content: message
    });

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      max_tokens: 500,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...sessions[sessionId].messages
      ]
    });

    const botResponse = completion.choices[0].message.content;

    sessions[sessionId].messages.push({
      role: 'assistant',
      content: botResponse
    });

    // Log ke Supabase
    await supabase.from('conversation_logs').insert({
      session_id: sessionId,
      user_message: message,
      bot_response: botResponse
    });

    const lowerBot = botResponse.toLowerCase();
    const userConfirm = message.toLowerCase().match(/\b(ya|iya|benar|betul|ok|oke)\b/);

    if (lowerBot.includes('konfirmasi') && userConfirm && !sessions[sessionId].isComplete) {
      const data = extractReservationData(sessions[sessionId]);

      if (data.phone && data.guests) {
        const code = generateReservationCode();

        const reservationData = {
          reservation_code: code,
          customer_name: data.name || 'Customer',
          phone: data.phone,
          reservation_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
          reservation_time: '18:00:00',
          guest_count: data.guests,
          status: 'confirmed'
        };

        const { error } = await supabase
          .from('reservations')
          .insert(reservationData);

        if (!error) {
          sessions[sessionId].isComplete = true;

          setTimeout(() => {
            delete sessions[sessionId];
          }, 300000);

          return res.json({
            success: true,
            message: `${botResponse}\n\n✅ Kode Reservasi Anda: ${code}`,
            reservationCode: code,
            isComplete: true
          });
        }
      }
    }

    return res.json({
      success: true,
      message: botResponse,
      isComplete: false
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
}
