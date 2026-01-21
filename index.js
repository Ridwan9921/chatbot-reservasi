// Load environment variables
require('dotenv').config();

// Import libraries
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const Groq = require('groq-sdk');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Initialize Groq AI client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Middleware
app.use(cors()); // Allow cross-origin requests
app.use(express.json()); // Parse JSON body

// System Prompt untuk AI Agent
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
8. Jika disetujui, berikan kode reservasi dan ucapkan terima kasih

CONTOH SAPAAN AWAL:
"Selamat datang di Restoran WAJIB! 👋
Saya siap membantu Anda membuat reservasi meja. 

Untuk memulai, kapan Anda ingin melakukan reservasi? Silakan sebutkan tanggal dan harinya."

OUTPUT FORMAT:
- Gunakan bahasa yang natural dan conversational
- Berikan respons yang singkat namun jelas
- Jika ada kesalahan, berikan saran yang konstruktif`;

// In-memory session storage
const sessions = {};

// Helper function: Generate reservation code
function generateReservationCode() {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return 'RES' + timestamp.slice(-8) + random;
}

// Helper function: Extract reservation data from AI response
function extractReservationData(conversation) {
  // This is a simple extraction - in production, you'd want more robust parsing
  const data = {
    date: null,
    time: null,
    guests: null,
    name: null,
    phone: null
  };
  
  // Try to find patterns in conversation
  const messages = conversation.messages || [];
  
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'user') {
      const content = msg.content.toLowerCase();
      
      // Extract phone number
      const phoneMatch = content.match(/\b(08\d{8,11}|628\d{8,11}|\+628\d{8,11})\b/);
      if (phoneMatch && !data.phone) {
        data.phone = phoneMatch[0];
      }
      
      // Extract guest count
      const guestMatch = content.match(/\b(\d+)\s*(orang|org|people|pax)\b/i);
      if (guestMatch && !data.guests) {
        data.guests = parseInt(guestMatch[1]);
      }
      
      // Extract name (simple heuristic)
      if (!data.name && i > 5 && content.length < 50 && !content.match(/\d{8,}/)) {
        const words = content.trim().split(/\s+/);
        if (words.length >= 1 && words.length <= 4) {
          data.name = content.trim();
        }
      }
    }
  }
  
  return data;
}

// Route: Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Chatbot Reservasi API is running!',
    timestamp: new Date().toISOString()
  });
});

// Route: Chat with AI
app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body;

    // Validate input
    if (!sessionId || !message) {
      return res.status(400).json({
        success: false,
        message: 'sessionId dan message harus diisi'
      });
    }

    // Initialize session if not exists
    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        messages: [],
        data: {},
        isComplete: false
      };
    }

    // Add user message to history
    sessions[sessionId].messages.push({
      role: 'user',
      content: message
    });

    // Call Groq AI
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...sessions[sessionId].messages
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      max_tokens: 500,
      top_p: 1,
      stream: false
    });

    const botResponse = completion.choices[0].message.content;

    // Add bot response to history
    sessions[sessionId].messages.push({
      role: 'assistant',
      content: botResponse
    });

    // Log conversation to database
    await supabase.from('conversation_logs').insert({
      session_id: sessionId,
      user_message: message,
      bot_response: botResponse
    });

    // Check if reservation is complete (simple heuristic)
    const lowerResponse = botResponse.toLowerCase();
    const isConfirming = lowerResponse.includes('konfirmasi') || 
                         lowerResponse.includes('benar') ||
                         lowerResponse.includes('sudah benar');
    const userConfirmed = message.toLowerCase().match(/\b(ya|benar|betul|iya|ok|oke|yes)\b/);
    
    if (isConfirming && userConfirmed && !sessions[sessionId].isComplete) {
      // Extract data from conversation
      const data = extractReservationData(sessions[sessionId]);
      
      // If we have minimum required data, save to database
      if (data.phone && data.guests) {
        const code = generateReservationCode();
        
        // Default values if data extraction failed
        const reservationData = {
          reservation_code: code,
          customer_name: data.name || 'Customer',
          phone: data.phone,
          reservation_date: data.date || new Date(Date.now() + 86400000).toISOString().split('T')[0], // Tomorrow
          reservation_time: data.time || '18:00:00',
          guest_count: data.guests,
          status: 'confirmed'
        };

        // Save to database
        const { error } = await supabase
          .from('reservations')
          .insert(reservationData);

        if (!error) {
          sessions[sessionId].isComplete = true;
          
          // Add reservation code to response
          const finalMessage = `${botResponse}\n\n✅ Kode Reservasi Anda: ${code}\n\nSimpan kode ini sebagai bukti reservasi. Terima kasih!`;
          
          // Clean up session after 5 minutes
          setTimeout(() => {
            delete sessions[sessionId];
          }, 300000);

          return res.json({
            success: true,
            message: finalMessage,
            sessionId: sessionId,
            reservationCode: code,
            isComplete: true
          });
        }
      }
    }

    res.json({
      success: true,
      message: botResponse,
      sessionId: sessionId,
      isComplete: false
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan. Silakan coba lagi.',
      error: error.message
    });
  }
});

// Route: Get all reservations
app.get('/api/reservations', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json({
      success: true,
      count: data.length,
      data: data
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Route: Get reservation by code
app.get('/api/reservations/:code', async (req, res) => {
  try {
    const { code } = req.params;

    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .eq('reservation_code', code)
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(404).json({
      success: false,
      message: 'Reservasi tidak ditemukan'
    });
  }
});

// Route: Delete/Cancel reservation
app.delete('/api/reservations/:code', async (req, res) => {
  try {
    const { code } = req.params;

    const { error } = await supabase
      .from('reservations')
      .update({ status: 'cancelled' })
      .eq('reservation_code', code);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Reservasi berhasil dibatalkan'
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
  console.log(`📊 Database: ${process.env.SUPABASE_URL ? 'Connected' : 'Not connected'}`);
  console.log(`🤖 AI: ${process.env.GROQ_API_KEY ? 'Ready' : 'Not configured'}`);
});

// Export for Vercel
module.exports = app;