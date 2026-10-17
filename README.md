# پروتکل ۳: بازی همکارانه خنثی‌سازی بمب (۳D لوکال)
### Protocol 3: Local 3-Player 3D Co-op Bomb Defusal Game

بازی خنثی‌سازی بمب ۳ نفره در شبکه محلی (Wi-Fi یا هات‌اسپات موبایل) با موتور گرافیکی **Three.js** به صورت کاملاً آفلاین و بدون وابستگی به اینترنت.

---

## 🎭 نقش‌های بازی

1. **نابینا (`blind`) — دستان و گوش‌های تیم:**
   - تنها نقشی که می‌تواند با لمس مستقیم ماژول‌های سه‌بعدی بمب (دکمه، سیم‌ها، کلیدها) تعامل کند.
   - بمب را کاملاً سیاه‌وسفید و مونوکروم می‌بیند (بدون رنگ، بدون شماره سریال، کلیدها فقط ۱ تا ۴).
   - تنها نقشی که صداها (تیک‌تاک، بوق اخطار، بازر خطا، انفجار و پیروزی) را می‌شنود.

2. **ناشنوا (`deaf`) — چشمان بینای تیم:**
   - بمب سه‌بعدی را با رنگ‌های واقعی، نمادهای کیپد و پلاک سریال در پشت بمب می‌بیند.
   - با کشیدن انگشت بمب را ۳۶۰ درجه می‌چرخاند و زوم می‌کند.
   - امکان لمس ماژول‌ها را ندارد و صدا برای او کاملاً قطع است.

3. **بی‌کلام (`mute`) — راهنمای قوانین رمزگشایی:**
   - دفترچه راهنمای دوبعدی قوانین (شروط خنثی‌سازی، نه پاسخ نهایی) در اختیار اوست.
   - در دنیای واقعی نباید صحبت کند و با اشاره یا نشان دادن قوانین تیم را هدایت می‌کند. صدا برای او نیز قطع است.

---

## 🛠️ ساختار فایل‌های پروژه

```text
├── package.json               # وابستگی‌های خالص (express, ws, three)
├── server.js                  # سرور Express و WebSocket و سرو آفلاین Three.js
├── README.md                  # راهنمای پروژه و افزودن ماژول
├── modules/                   # ماژول‌های سمت سرور
│   ├── index.js               # رجیستری ماژول‌های فعال سرور
│   ├── button.js              # ماژول دکمه کاتالیزور (سرور)
│   ├── wires.js               # ماژول فیوزهای سیم‌کشی (سرور)
│   └── keypad.js              # ماژول نمادهای رمزی (سرور)
└── public/                    # کلاینت وب (موبایل‌محور)
    ├── index.html             # اسکلت برنامه با Import Map محلی Three.js
    ├── style.css              # استایل HUD بمب و ویوپورت ۳D
    ├── app.js                 # کنترلر اصلی کلاینت و هماهنگ‌کننده ۳D
    ├── bomb3d.js              # صحنه سه‌بعدی Three.js، رندرینگ و درگ-روتیت لمسی
    ├── transport.js           # لایه ارتباط شبکه و همگام‌سازی ساعت با ping/pong
    ├── audio.js               # سنتز صدای مستقل Web Audio API
    └── modules/               # ماژول‌های ۳D سمت کلاینت
        ├── index.js           # رجیستری ماژول‌های فعال کلاینت
        ├── button.js          # پیاده‌سازی سه‌بعدی دکمه
        ├── wires.js           # پیاده‌سازی سه‌بعدی سیم‌ها
        └── keypad.js          # پیاده‌سازی سه‌بعدی کلیدها
```

---

## 🧩 راهنمای افزودن ماژول جدید (Adding a New Module)

معماری پروژه کاملاً ماژولار و قابل توسعه است (پشتیبانی خودکار از ۳ تا ۶ اسلات روی بدنه بمب). برای افزودن یک ماژول جدید:

### گام ۱: ساخت فایل ماژول در سرور (`modules/yourModule.js`)
این فایل باید آبجکتی با این متدها export کند:
```javascript
export const yourModule = {
  id: 'your_module_id',
  title: 'عنوان ماژول',
  create(rng, ctx) {
    // تولید وضعیت سری و بازگرداندن state
    return { id: 'your_module_id', solved: false, secretKey: 42 };
  },
  filterForRole(role, state) {
    // فیلتر اطلاعات محرمانه بر اساس نقش
    // هرگز پاسخ نهایی یا فیلد محرمانه به کلاینت ارسال نشود!
    return { id: 'your_module_id', solved: state.solved };
  },
  handleAction(state, action, data, ctx) {
    // بررسی اکشن ارسالی از نابینا و برگرداندن نتیجه
    if (action === 'solve') {
      state.solved = true;
      return { solved: true, strike: false, reason: 'ماژول حل شد!' };
    }
    return { solved: false, strike: true, reason: 'اقدام اشتباه!' };
  },
  isSolved(state) {
    return !!state.solved;
  }
};
```

### گام ۲: ثبت ماژول در `modules/index.js`
ماژول را import کرده و به آرایه `activeModules` اضافه کنید:
```javascript
import { yourModule } from './yourModule.js';

export const activeModules = [
  buttonModule,
  wiresModule,
  keypadModule,
  yourModule // ماژول جدید شما
];
```

### گام ۳: ساخت فایل ماژول در کلاینت (`public/modules/yourModule.js`)
```javascript
export const yourClientModule = {
  id: 'your_module_id',
  title: 'عنوان ماژول',
  build(THREE, slot, role) {
    const group = new THREE.Group();
    // ساخت اشکال و متریال‌های سه‌بعدی در ابعاد slot.width و slot.height
    return group;
  },
  update(moduleView, role, state) {
    // به‌روزرسانی وضعیت ظاهری (رنگ‌ها در نقش deaf، مونوکروم در blind)
  },
  onPointer(hit, event, send, moduleView, role, state) {
    // مدیریت لمس برای نقش blind و فراخوانی send('action', { moduleId, action, data })
  }
};
```

### گام ۴: ثبت ماژول در `public/modules/index.js`
```javascript
import { yourClientModule } from './yourModule.js';

export const clientModules = [
  buttonClientModule,
  wiresClientModule,
  keypadClientModule,
  yourClientModule // ماژول جدید شما
];
```

بدون نیاز به دستکاری در `server.js`، `app.js` یا هندسه‌ی بدنه بمب، اسلات ماژول به صورت خودکار روی بدنه ۳D ساخته شده و در بازی فعال می‌شود!

---

## 🚀 دستورات اجرا

### ۱. ویندوز (Windows)
```powershell
npm install
node server.js
```

### ۲. اندروید (Termux)
```bash
pkg update && pkg install nodejs
npm install
node server.js
```

آدرس آی‌پی محلی (مثلاً `http://192.168.43.1:3000`) در کنسول چاپ می‌شود و هر ۳ گوشی بدون نیاز به اینترنت می‌توانند به آن متصل شوند.
