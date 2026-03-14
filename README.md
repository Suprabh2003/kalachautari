# कलाचौतारी — Kalachautari
## Nepali Creative Collaboration Platform

### Quick Start

```bash
npm install
node --experimental-sqlite server/index.js
```

Open http://localhost:3000

Demo login: aasha@demo.com / demo1234

### Deploy to Railway

1. Push this repo to GitHub
2. Go to railway.app → New Project → Deploy from GitHub
3. Set start command: `node --experimental-sqlite server/index.js`
4. Add environment variable: `JWT_SECRET=your-secret-here`
5. Railway gives you a public URL instantly

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Server port | 3000 |
| `JWT_SECRET` | Secret for auth tokens | kalachautari-secret-2025 |

### Tech Stack
- **Backend**: Node.js + Express
- **Database**: SQLite (built into Node 22, zero setup)
- **Real-time**: WebSocket (ws)
- **Auth**: JWT + bcrypt
- **Frontend**: Vanilla HTML/CSS/JS (no build step needed)

### Features
- User registration & login
- Post projects with 4-step form
- Express interest → owner gets instant notification
- Swipe-based creator matching
- Real-time messaging (direct + group)
- Events with ticket tiers & RSVP
- Bilingual EN/नेपाली toggle
- Nepali typography (Yatra One, Tiro Devanagari Nepali)
