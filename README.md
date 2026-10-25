# คลิปเล่าเรื่อง (เฟสแรก)

เว็บแอปบน Vercel สำหรับสร้างคลิปวิดีโอสั้นจากข้อความและภาพแนบ ผู้ใช้ล็อกอินด้วย Google, Claude แตกเรื่องเป็นสตอรีบอร์ด, Google Text-to-Speech สร้างเสียงพูด แล้วเบราว์เซอร์ประกอบคลิปเป็น MP4 เอง (Canvas + WebAudio + MediaRecorder, ใช้ ffmpeg.wasm เฉพาะเมื่อเบราว์เซอร์อัดเป็น MP4 ไม่ได้)

- ความยาว 5 / 10 / 15 / 30 วินาที, สัดส่วน 9:16 (720×1280) หรือ 16:9 (1280×720)
- ตัวละคร 1 ถึง 2 ตัว, เสียงพากย์ไทยหรืออังกฤษ, เสียงเอฟเฟกต์สังเคราะห์
- โควตา 10 คลิปต่อเดือนต่อคน (เวลาไทย) ผู้ดูแลปรับรายคนได้ที่คอลัมน์ `monthly_quota` ในตาราง `profiles` ของ Supabase

## โครงสร้าง

```
api/            Vercel Serverless Functions (Node 20)
  _lib/         auth, supabase service client, validate, errors, quota helpers
  config.js     GET  ค่าสาธารณะ
  me.js         GET  โควตาและโปรไฟล์
  storyboard.js POST สร้างสตอรีบอร์ด (ไม่หักโควตา, จำกัด 10 ครั้ง/ชั่วโมง)
  render-ticket.js POST ออกตั๋วเรนเดอร์ (หักโควตา 1)
  tts.js        POST สร้างเสียงพูด (ต้องมีตั๋ว, สูงสุด 24 ครั้งต่อตั๋ว)
public/         หน้าเว็บ (HTML + CSS + ES modules ไม่มี bundler)
supabase/schema.sql
scripts/        check_storyboard.js, check_quota.js
```

## ขั้นตอนตั้งค่า

1. **Supabase** สร้าง 2 โปรเจกต์ (ของจริง และของทดสอบ) แล้วเปิด SQL Editor รันไฟล์ `supabase/schema.sql` ในทั้งสองโปรเจกต์
2. **Google OAuth**
   - ที่ Google Cloud Console สร้าง OAuth client แบบ Web application ใส่ Authorized redirect URI เป็น `https://<project-ref>.supabase.co/auth/v1/callback`
   - ที่ Supabase > Authentication > Providers เปิด Google ใส่ Client ID และ Client Secret
   - ที่ Supabase > Authentication > URL Configuration ตั้ง Site URL เป็นโดเมนจริง (เช่น `https://clip.example.com`) และเพิ่มโดเมนเดียวกันใน Redirect URLs (ถ้าใช้ preview ของ Vercel ให้เพิ่มโดเมน preview ด้วย)
3. **Google Text-to-Speech** ที่ Google Cloud เปิด Cloud Text-to-Speech API สร้าง API key แล้วจำกัด API restrictions ให้ใช้ได้เฉพาะ Text-to-Speech API ชื่อเสียงที่ใช้อยู่ในค่าคงที่ `VOICES` ใน `api/tts.js` จุดเดียว (ตรวจว่าเสียงยังมีให้บริการใน [รายการเสียง](https://cloud.google.com/text-to-speech/docs/voices) ก่อนดีพลอย)
4. **Anthropic** สร้าง API key ที่ Anthropic Console
5. **เพดานค่าใช้จ่าย** (เจ้าของโปรเจกต์ตั้งเอง)
   - Anthropic Console > Limits ตั้ง monthly spend limit
   - Google Cloud > Billing > Budgets & alerts ตั้งงบประมาณและการแจ้งเตือน และตั้ง quota ของ Text-to-Speech API (requests per minute / characters per day) ใน APIs & Services > Quotas
6. **Vercel** import repo นี้ เลือก Framework Preset เป็น Other (ไม่ต้องมี build command, Vercel จะเสิร์ฟโฟลเดอร์ `public/` และฟังก์ชันใน `api/`) แล้วตั้ง Environment Variables ตามตารางด้านล่าง (ไม่ต้องใส่ `TEST_*`)
7. ดีพลอย แล้วทำรายการทดสอบมือในหัวข้อ "การตรวจสอบ"

| ตัวแปร | ใช้ที่ | หมายเหตุ |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | เซิร์ฟเวอร์ | ลับ ห้าม commit |
| `CLAUDE_MODEL` | เซิร์ฟเวอร์ | ค่าเริ่มต้น `claude-sonnet-5-5` |
| `GOOGLE_TTS_API_KEY` | เซิร์ฟเวอร์ | ลับ ห้าม commit |
| `SUPABASE_URL` | เซิร์ฟเวอร์ + ส่งให้เบราว์เซอร์ผ่าน `/api/config` | สาธารณะ |
| `SUPABASE_ANON_KEY` | ส่งให้เบราว์เซอร์ผ่าน `/api/config` | สาธารณะ |
| `SUPABASE_SERVICE_ROLE_KEY` | เซิร์ฟเวอร์ | ลับ ห้าม commit |
| `TEST_SUPABASE_URL`, `TEST_SUPABASE_SERVICE_ROLE_KEY` | `npm run check:quota` เท่านั้น | ต้องชี้ไปโปรเจกต์ทดสอบ ห้ามชี้ของจริง |

คีย์ลับทั้งหมดใช้เฉพาะในโฟลเดอร์ `api/` เบราว์เซอร์ได้รับแค่ `supabaseUrl` และ `supabaseAnonKey` จาก `/api/config` ตารางทั้งหมดเปิด RLS โดยไม่มี policy จึงเข้าถึงได้เฉพาะผ่านฟังก์ชันฝั่งเซิร์ฟเวอร์

## รันในเครื่อง

```bash
npm install
cp .env.example .env    # ใส่ค่าให้ครบ
npx vercel dev          # เปิด http://localhost:3000
```

ถ้ารันในเครื่องต้องเพิ่ม `http://localhost:3000` ใน Redirect URLs ของ Supabase ด้วย

## การตรวจสอบ

```bash
npm run check
```

- `check:storyboard` ทดสอบ `validateScenes()` และการตรวจ input (ไม่ต้องใช้เน็ต)
- `check:quota` ยิงฟังก์ชันในฐานข้อมูลของ **โปรเจกต์ทดสอบ** ต้องตั้ง `TEST_SUPABASE_URL` และ `TEST_SUPABASE_SERVICE_ROLE_KEY` ก่อน (เช่น `set -a; . ./.env; set +a; npm run check:quota`) ถ้าไม่ได้ตั้งจะข้ามพร้อมข้อความ และจะไม่ยอมรันถ้า `TEST_SUPABASE_URL` เท่ากับ `SUPABASE_URL` สคริปต์สร้างผู้ใช้ชั่วคราว `@quota-check.invalid` แล้วลบทิ้ง (ข้อมูลตั๋วถูกลบตามด้วย cascade)

ทดสอบมือบนมือถือจริง (Android ระดับกลาง และ iPhone):

- [ ] ผู้ใช้ใหม่ล็อกอินด้วย Google ได้ (ต้องติ๊กยอมรับก่อน)
- [ ] สร้างคลิป 5 วินาที แนวตั้ง 9:16 ได้ไฟล์ MP4 เปิดเล่นได้ มีเสียงพูดและเสียงเอฟเฟกต์
- [ ] สร้างคลิป 5 วินาที แนวนอน 16:9 เช่นเดียวกัน
- [ ] โควตาลดลง 1 หลังกด "สร้างคลิป หักโควตา 1 ครั้ง"
- [ ] กลับไปสตอรีบอร์ดแล้วสร้างซ้ำด้วยตั๋วเดิม โควตาไม่ลดเพิ่ม
- [ ] โควตาหมด: ตั้ง `monthly_quota` เป็น 0 แล้วกดสร้างคลิป เห็นหน้าโควตาหมดพร้อมวันรีเซ็ต (พ.ศ.)
- [ ] TTS ล้มเหลว: ตั้ง `GOOGLE_TTS_API_KEY` ผิดใน preview แล้วสร้างคลิป เห็นข้อความ "สร้างเสียงพูดไม่สำเร็จ โควตาของคุณยังไม่ถูกหักเพิ่ม ลองอีกครั้งได้เลย"
- [ ] ออฟไลน์: เปิดโหมดเครื่องบิน เห็นแบนเนอร์ และปุ่มที่ต้องใช้เน็ตบอกให้เชื่อมต่อก่อน
- [ ] ซ่อนแท็บหรือสลับแอประหว่างอัด การอัดหยุดพร้อมข้อความให้อยู่หน้านี้ และลองใหม่ได้ด้วยตั๋วเดิม

## กติกาโควตา

- "ใช้ไป" = จำนวนแถวใน `render_tickets` ของเดือนนั้น (เวลาไทย) ตั๋วหนึ่งใบ = หนึ่งคลิป
- ตั๋วมีอายุ 30 นาที ขอเสียงพูดได้สูงสุด 24 ครั้งต่อตั๋ว เสียงที่ได้เก็บไว้ในหน่วยความจำของเบราว์เซอร์ การอัดซ้ำด้วยบทเดิมจึงไม่ต้องขอเสียงใหม่และไม่หักโควตาเพิ่ม
- `issue_render_ticket` ล็อกแถว profile ด้วย `for update` กันการกดพร้อมกันเกินโควตา
- การสร้างสตอรีบอร์ดไม่หักโควตา แต่จำกัด 10 ครั้งต่อชั่วโมงต่อคน

## ความเป็นส่วนตัว

- ไม่เก็บภาพ เสียง หรือคลิปไว้ฝั่งเซิร์ฟเวอร์ ภาพถูกย่อในเบราว์เซอร์ (ด้านยาวไม่เกิน 1024 px) แล้วส่งต่อให้ Claude ในคำขอเดียว
- ฟังก์ชันฝั่งเซิร์ฟเวอร์ไม่ log ข้อความหรือภาพของผู้ใช้ log เฉพาะรหัสข้อผิดพลาด
- เฟสนี้ผู้ใช้ขอลบข้อมูลผ่านผู้ดูแล (ลบผู้ใช้ใน Supabase > Authentication แล้วข้อมูลในตารางจะถูกลบตาม)

## ข้อที่ยังรอเจ้าของโปรเจกต์ยืนยัน

- ช่องทางติดต่อผู้ดูแลเพื่อขอเพิ่มโควตา ตอนนี้เป็นค่าตัวอย่างในค่าคงที่ `ADMIN_CONTACT` ใน `public/js/main.js` พร้อมป้าย "ตัวอย่าง"
- ข้อความข้อตกลงการใช้งานและนโยบายความเป็นส่วนตัวฉบับจริง (ตอนนี้เป็นข้อความตัวอย่างใน `public/index.html`)
- ชื่อแอป (ตอนนี้ใช้ "คลิปเล่าเรื่อง" เป็นข้อความ ยังไม่มีโลโก้) และการยืนยันว่าใช้โทเค็นแบรนด์ GV
- ช่องทางลบข้อมูลตาม PDPA และการทดสอบหน้าจอกับผู้ใช้จริง 2 ถึง 3 คนก่อนเปิดสาธารณะ
