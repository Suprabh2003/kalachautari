#!/usr/bin/env node
'use strict';

const express    = require('express');
const http       = require('http');
const WebSocket  = require('ws');
const path       = require('path');
const cors       = require('cors');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const multer     = require('multer');
const { v4: uuid } = require('uuid');
const fs         = require('fs');

// ─── Node 22 built-in SQLite ──────────────────────────────────────────────────
const DatabaseSync = require('better-sqlite3');

const JWT_SECRET = process.env.JWT_SECRET || 'kalachautari-secret-2025';
const PORT       = process.env.PORT || 3000;
const DB_PATH    = path.join(__dirname, '../data/kalachautari.db');
const UPLOAD_DIR = path.join(__dirname, '../uploads');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ─── Database setup ───────────────────────────────────────────────────────────
const db = new DatabaseSync(DB_PATH, { verbose: false });

db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  name_np     TEXT,
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT '',
  bio         TEXT DEFAULT '',
  bio_np      TEXT DEFAULT '',
  location    TEXT DEFAULT '',
  disciplines TEXT DEFAULT '[]',
  skills      TEXT DEFAULT '[]',
  genres      TEXT DEFAULT '[]',
  avatar_init TEXT DEFAULT '',
  avatar_color TEXT DEFAULT 'rust',
  portfolio_links TEXT DEFAULT '[]',
  open_to_remote INTEGER DEFAULT 1,
  experience_years INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  title_np    TEXT DEFAULT '',
  type        TEXT NOT NULL,
  description TEXT DEFAULT '',
  description_np TEXT DEFAULT '',
  roles_needed TEXT DEFAULT '[]',
  timeline    TEXT DEFAULT '',
  location    TEXT DEFAULT '',
  remote_ok   INTEGER DEFAULT 1,
  experience_req TEXT DEFAULT 'Any',
  max_collaborators INTEGER DEFAULT 5,
  status      TEXT DEFAULT 'open',
  media_links TEXT DEFAULT '[]',
  cover_url   TEXT DEFAULT '',
  view_count  INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interests (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  role_offer  TEXT DEFAULT '',
  message     TEXT DEFAULT '',
  portfolio_link TEXT DEFAULT '',
  status      TEXT DEFAULT 'pending',
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, user_id)
);

CREATE TABLE IF NOT EXISTS matches (
  id          TEXT PRIMARY KEY,
  user_a      TEXT NOT NULL REFERENCES users(id),
  user_b      TEXT NOT NULL REFERENCES users(id),
  type        TEXT DEFAULT 'connect',
  status      TEXT DEFAULT 'pending',
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(user_a, user_b)
);

CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  type        TEXT DEFAULT 'direct',
  project_id  TEXT REFERENCES projects(id),
  name        TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conv_members (
  conv_id     TEXT NOT NULL REFERENCES conversations(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  joined_at   TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (conv_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  conv_id     TEXT NOT NULL REFERENCES conversations(id),
  sender_id   TEXT REFERENCES users(id),
  type        TEXT DEFAULT 'text',
  content     TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  creator_id  TEXT REFERENCES users(id),
  title       TEXT NOT NULL,
  title_np    TEXT DEFAULT '',
  description TEXT DEFAULT '',
  location    TEXT DEFAULT '',
  event_date  TEXT NOT NULL,
  event_time  TEXT DEFAULT '',
  is_online   INTEGER DEFAULT 0,
  is_free     INTEGER DEFAULT 1,
  ticket_tiers TEXT DEFAULT '[]',
  tags        TEXT DEFAULT '[]',
  cover_url   TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rsvps (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  tier        TEXT DEFAULT 'general',
  qty         INTEGER DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, user_id)
);

CREATE TABLE IF NOT EXISTS portfolio_items (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  type        TEXT NOT NULL,
  description TEXT DEFAULT '',
  file_url    TEXT DEFAULT '',
  external_url TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT DEFAULT '',
  link        TEXT DEFAULT '',
  read        INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);
`);

// ─── Seed demo data if empty ──────────────────────────────────────────────────
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
if (userCount.c === 0) {
  console.log('Seeding demo data...');
  seedDemo();
}

function seedDemo() {
  const hash = bcrypt.hashSync('demo1234', 10);
  const users = [
    { id: 'u1', name: 'Aasha Gurung',   name_np: 'आशा गुरुङ',   email: 'aasha@demo.com',  role: 'Singer · Songwriter',    bio: 'Folk-influenced indie artist from Pokhara.', location: 'Pokhara',     disciplines: '["musician"]', skills: '["Vocals","Songwriting","Production","Sarangi"]', genres: '["Folk Fusion","Indie Pop","Lok Dohori"]', avatar_init: 'आ', avatar_color: 'rust',  experience_years: 7 },
    { id: 'u2', name: 'Bikash Magar',   name_np: 'बिकाश मगर',   email: 'bikash@demo.com', role: 'Filmmaker · Director',   bio: 'Documentary and narrative filmmaker. 5 films, 3 intl festivals.', location: 'Kathmandu', disciplines: '["filmmaker"]', skills: '["Direction","Cinematography","Editing"]', genres: '["Documentary","Short Film"]', avatar_init: 'बि', avatar_color: 'blue',  experience_years: 7 },
    { id: 'u3', name: 'Mira Thapa',     name_np: 'मीरा थापा',   email: 'mira@demo.com',   role: 'Poet · Writer',          bio: 'Writing in Nepali and English. 3 anthologies.', location: 'London, UK', disciplines: '["writer"]',    skills: '["Poetry","Short Fiction","Translation"]', genres: '["Literary Fiction","Poetry"]', avatar_init: 'मी', avatar_color: 'gold',  experience_years: 6 },
    { id: 'u4', name: 'Sujen Rai',      name_np: 'सुजन राई',    email: 'sujen@demo.com',  role: 'Guitarist · Producer',   bio: 'Folk fusion and indie rock. Remote collabs welcome.', location: 'Sydney, AU', disciplines: '["musician"]',  skills: '["Guitar","Music Production","Mixing"]', genres: '["Folk Fusion","Indie Rock"]', avatar_init: 'सु', avatar_color: 'rust',  experience_years: 10 },
    { id: 'u5', name: 'Anita Lama',     name_np: 'अनिता लामा',  email: 'anita@demo.com',  role: 'Illustrator',            bio: 'Thangka-inspired illustration. Album covers, zines.', location: 'Pokhara',  disciplines: '["visual"]',    skills: '["Illustration","Thangka Art","Design"]', genres: '["Visual Art","Illustration"]', avatar_init: 'अ', avatar_color: 'green', experience_years: 5 },
    { id: 'u6', name: 'Roshan Tamang',  name_np: 'रोशन तामाङ',  email: 'roshan@demo.com', role: 'Screenwriter · Director',bio: 'Short film specialist. Three Cannes-shortlisted scripts.', location: 'Paris, FR', disciplines: '["filmmaker"]', skills: '["Screenwriting","Direction","Storyboarding"]', genres: '["Short Film","Drama"]', avatar_init: 'रो', avatar_color: 'blue',  experience_years: 6 },
  ];
  const ins = db.prepare(`INSERT INTO users (id,name,name_np,email,password,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  users.forEach(u => ins.run(u.id, u.name, u.name_np, u.email, hash, u.role, u.bio, u.location, u.disciplines, u.skills, u.genres, u.avatar_init, u.avatar_color, u.experience_years));

  const projects = [
    { id: 'p1', owner_id: 'u1', title: 'Himalaya EP',         title_np: 'हिमालय EP',          type: 'Music',      description: '6-track folk fusion EP blending indie production with Nepali folk melodies. Remote collaboration welcome.', description_np: 'नेपाली लोक धुनसँग इन्डी उत्पादन मिलाएको ६-ट्र्याक EP।', roles_needed: '["Tabla Player","Videographer","Mixing Engineer"]', timeline: '3-6 months', location: 'Pokhara', remote_ok: 1 },
    { id: 'p2', owner_id: 'u6', title: 'Bato — Short Film',   title_np: 'बाटो — छोटो फिल्म',  type: 'Film',       description: '20-minute narrative short about migration. Kathmandu to Doha. Script ready.', description_np: 'प्रवासबारे २०-मिनेटको छोटो फिल्म।', roles_needed: '["Cinematographer","Sound Designer","Lead Actor"]', timeline: '1-3 months', location: 'Kathmandu', remote_ok: 0 },
    { id: 'p3', owner_id: 'u3', title: 'Kavita Sangrah',      title_np: 'कविता संग्रह',        type: 'Literature', description: 'Bilingual poetry collection — Nepali and English. Seeking illustrator and book designer.', description_np: 'द्विभाषी कविता संग्रह।', roles_needed: '["Illustrator","Book Designer"]', timeline: '1-3 months', location: 'Remote', remote_ok: 1 },
    { id: 'p4', owner_id: 'u5', title: 'Thangka Meets Beat',  title_np: 'थाङ्का मिट्स बिट',   type: 'Visual Art', description: 'Audio-visual combining traditional Thangka art with electronic music.', description_np: 'थाङ्का कला र इलेक्ट्रोनिक संगीतको प्रयोगात्मक परियोजना।', roles_needed: '["Electronic Producer","Animator","Curator"]', timeline: 'Ongoing', location: 'Remote', remote_ok: 1 },
  ];
  const insp = db.prepare(`INSERT INTO projects (id,owner_id,title,title_np,type,description,description_np,roles_needed,timeline,location,remote_ok) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  projects.forEach(p => insp.run(p.id, p.owner_id, p.title, p.title_np, p.type, p.description, p.description_np, p.roles_needed, p.timeline, p.location, p.remote_ok));

  const events = [
    { id: 'e1', creator_id: 'u1', title: 'Kala Saanjh — Open Mic', title_np: 'कला साँझ — ओपन माइक', description: 'Monthly open mic for all Nepali creatives', location: 'Patan Dhoka, Lalitpur', event_date: '2026-03-22', event_time: '17:00', is_free: 1, tags: '["Music","Poetry","Free"]', ticket_tiers: '[{"name":"General","price":0,"desc":"Open floor"},{"name":"Supporter","price":500,"desc":"Reserved seat + booklet"}]' },
    { id: 'e2', creator_id: 'u2', title: 'Diaspora Creatives Meetup — London', title_np: 'डायस्पोरा सिर्जनशील भेट — लन्डन', description: 'Networking event for Nepali creatives in London', location: 'Nepal Centre, London', event_date: '2026-04-05', event_time: '15:00', is_free: 0, tags: '["Networking","All Arts"]', ticket_tiers: '[{"name":"General","price":0,"desc":"Walk-in"},{"name":"VIP","price":1500,"desc":"Front row + networking dinner"}]' },
    { id: 'e3', creator_id: 'u6', title: 'Short Film Workshop — Dev Poudel', title_np: 'लघु फिल्म कार्यशाला', description: 'Online masterclass on short film cinematography', location: 'Online (Zoom)', event_date: '2026-04-18', event_time: '18:00', is_online: 1, is_free: 0, tags: '["Film","Workshop"]', ticket_tiers: '[{"name":"Early Bird","price":500,"desc":"Limited"},{"name":"Standard","price":800,"desc":"Full access"}]' },
  ];
  const inse = db.prepare(`INSERT INTO events (id,creator_id,title,title_np,description,location,event_date,event_time,is_online,is_free,tags,ticket_tiers) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  events.forEach(e => inse.run(e.id, e.creator_id, e.title, e.title_np, e.description, e.location, e.event_date, e.event_time, e.is_online||0, e.is_free, e.tags, e.ticket_tiers));

  // create a group conv for Himalaya EP
  db.prepare(`INSERT INTO conversations (id,type,project_id,name) VALUES (?,?,?,?)`).run('c1','group','p1','Himalaya EP — Team');
  ['u1','u2','u4'].forEach(uid => db.prepare(`INSERT INTO conv_members (conv_id,user_id) VALUES (?,?)`).run('c1', uid));
  db.prepare(`INSERT INTO messages (id,conv_id,sender_id,type,content) VALUES (?,?,?,?,?)`).run(uuid(),'c1',null,'system','Group created: Himalaya EP Collaboration');
  db.prepare(`INSERT INTO messages (id,conv_id,sender_id,type,content) VALUES (?,?,?,?,?)`).run(uuid(),'c1','u2','text','Great recording session yesterday everyone!');
  db.prepare(`INSERT INTO messages (id,conv_id,sender_id,type,content) VALUES (?,?,?,?,?)`).run(uuid(),'c1','u4','text','The tabla tracks sounded amazing. I\'ll export the stems today.');

  console.log('Demo data seeded. Login: aasha@demo.com / demo1234');
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(h.replace('Bearer ', ''), JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

function optAuth(req, res, next) {
  const h = req.headers.authorization;
  if (h) { try { req.user = jwt.verify(h.replace('Bearer ', ''), JWT_SECRET); } catch {} }
  next();
}

// ─── Express setup ────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, '../client/public')));

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 100 * 1024 * 1024 } });

// helper to push notification
function pushNotif(userId, type, title, body = '', link = '') {
  db.prepare(`INSERT INTO notifications (id,user_id,type,title,body,link) VALUES (?,?,?,?,?,?)`).run(uuid(), userId, type, title, body, link);
  // broadcast via ws if user connected
  const ws = wsClients.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: 'notification', data: { type, title, body, link } }));
  }
}

// ─── AUTH ROUTES ─────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role, location, disciplines } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already registered' });
  const id = uuid();
  const hash = bcrypt.hashSync(password, 10);
  const init = name.charAt(0).toUpperCase();
  const colors = ['rust','blue','gold','green'];
  const color = colors[Math.floor(Math.random()*colors.length)];
  db.prepare(`INSERT INTO users (id,name,email,password,role,location,disciplines,avatar_init,avatar_color) VALUES (?,?,?,?,?,?,?,?,?)`).run(id, name, email, hash, role||'', location||'', JSON.stringify(disciplines||[]), init, color);
  const token = jwt.sign({ id, name, email }, JWT_SECRET, { expiresIn: '30d' });
  const user = db.prepare('SELECT id,name,name_np,email,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years,open_to_remote FROM users WHERE id=?').get(id);
  res.json({ token, user });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
  const safe = { ...user }; delete safe.password;
  res.json({ token, user: safe });
});

// ─── USER ROUTES ─────────────────────────────────────────────────────────────
app.get('/api/users', optAuth, (req, res) => {
  const { type, search, location } = req.query;
  let sql = `SELECT id,name,name_np,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years,open_to_remote,created_at FROM users WHERE 1=1`;
  const params = [];
  if (type) { sql += ` AND disciplines LIKE ?`; params.push(`%${type}%`); }
  if (search) { sql += ` AND (name LIKE ? OR role LIKE ? OR skills LIKE ?)`; params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  if (location) { sql += ` AND location LIKE ?`; params.push(`%${location}%`); }
  sql += ` ORDER BY created_at DESC`;
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/users/:id', (req, res) => {
  const u = db.prepare('SELECT id,name,name_np,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years,open_to_remote,created_at FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  u.projects = db.prepare('SELECT id,title,type,status FROM projects WHERE owner_id=? AND status="open"').all(req.params.id);
  u.portfolio = db.prepare('SELECT * FROM portfolio_items WHERE user_id=? ORDER BY created_at DESC').all(req.params.id);
  res.json(u);
});

app.patch('/api/users/me', auth, (req, res) => {
  const { name, name_np, role, bio, bio_np, location, disciplines, skills, genres, experience_years, open_to_remote } = req.body;
  db.prepare(`UPDATE users SET name=COALESCE(?,name), name_np=COALESCE(?,name_np), role=COALESCE(?,role), bio=COALESCE(?,bio), bio_np=COALESCE(?,bio_np), location=COALESCE(?,location), disciplines=COALESCE(?,disciplines), skills=COALESCE(?,skills), genres=COALESCE(?,genres), experience_years=COALESCE(?,experience_years), open_to_remote=COALESCE(?,open_to_remote) WHERE id=?`).run(name, name_np, role, bio, bio_np, location, disciplines ? JSON.stringify(disciplines) : null, skills ? JSON.stringify(skills) : null, genres ? JSON.stringify(genres) : null, experience_years, open_to_remote !== undefined ? (open_to_remote ? 1 : 0) : null, req.user.id);
  res.json(db.prepare('SELECT id,name,name_np,role,bio,bio_np,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years,open_to_remote FROM users WHERE id=?').get(req.user.id));
});

// ─── PROJECT ROUTES ───────────────────────────────────────────────────────────
app.get('/api/projects', optAuth, (req, res) => {
  const { type, remote, search, status } = req.query;
  let sql = `SELECT p.*, u.name as owner_name, u.avatar_init as owner_init, u.avatar_color as owner_color,
    (SELECT COUNT(*) FROM interests WHERE project_id=p.id) as interest_count
    FROM projects p JOIN users u ON p.owner_id=u.id WHERE 1=1`;
  const params = [];
  if (status) { sql += ` AND p.status=?`; params.push(status); } else { sql += ` AND p.status='open'`; }
  if (type) { sql += ` AND p.type=?`; params.push(type); }
  if (remote === '1') { sql += ` AND p.remote_ok=1`; }
  if (search) { sql += ` AND (p.title LIKE ? OR p.description LIKE ?)`; params.push(`%${search}%`,`%${search}%`); }
  sql += ` ORDER BY p.created_at DESC`;
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/projects/:id', optAuth, (req, res) => {
  const p = db.prepare(`SELECT p.*, u.name as owner_name, u.name_np as owner_name_np, u.avatar_init as owner_init, u.avatar_color as owner_color, u.location as owner_location,
    (SELECT COUNT(*) FROM interests WHERE project_id=p.id) as interest_count
    FROM projects p JOIN users u ON p.owner_id=u.id WHERE p.id=?`).get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE projects SET view_count=view_count+1 WHERE id=?`).run(req.params.id);
  if (req.user) {
    p.my_interest = db.prepare('SELECT * FROM interests WHERE project_id=? AND user_id=?').get(req.params.id, req.user.id);
  }
  res.json(p);
});

app.post('/api/projects', auth, (req, res) => {
  const { title, title_np, type, description, description_np, roles_needed, timeline, location, remote_ok, experience_req, max_collaborators, media_links, cover_url } = req.body;
  if (!title || !type) return res.status(400).json({ error: 'title and type required' });
  const id = uuid();
  db.prepare(`INSERT INTO projects (id,owner_id,title,title_np,type,description,description_np,roles_needed,timeline,location,remote_ok,experience_req,max_collaborators,media_links,cover_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, req.user.id, title, title_np||'', type, description||'', description_np||'', JSON.stringify(roles_needed||[]), timeline||'', location||'', remote_ok?1:0, experience_req||'Any', max_collaborators||5, JSON.stringify(media_links||[]), cover_url||'');
  const project = db.prepare('SELECT p.*, u.name as owner_name, u.avatar_init as owner_init FROM projects p JOIN users u ON p.owner_id=u.id WHERE p.id=?').get(id);
  res.status(201).json(project);
});

app.patch('/api/projects/:id', auth, (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const { title, description, status, roles_needed } = req.body;
  db.prepare(`UPDATE projects SET title=COALESCE(?,title), description=COALESCE(?,description), status=COALESCE(?,status), roles_needed=COALESCE(?,roles_needed) WHERE id=?`).run(title, description, status, roles_needed ? JSON.stringify(roles_needed) : null, req.params.id);
  res.json(db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id));
});

// ─── INTEREST / SUBSCRIBE ROUTES ─────────────────────────────────────────────
app.get('/api/projects/:id/interests', auth, (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const interests = db.prepare(`SELECT i.*, u.name, u.name_np, u.role, u.avatar_init, u.avatar_color, u.location, u.skills, u.portfolio_links FROM interests i JOIN users u ON i.user_id=u.id WHERE i.project_id=? ORDER BY i.created_at DESC`).all(req.params.id);
  res.json(interests);
});

app.post('/api/projects/:id/interest', auth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.owner_id === req.user.id) return res.status(400).json({ error: 'Cannot express interest in your own project' });

  const { role_offer, message, portfolio_link } = req.body;
  const existing = db.prepare('SELECT * FROM interests WHERE project_id=? AND user_id=?').get(req.params.id, req.user.id);
  if (existing) return res.status(409).json({ error: 'Already expressed interest' });

  const id = uuid();
  db.prepare(`INSERT INTO interests (id,project_id,user_id,role_offer,message,portfolio_link) VALUES (?,?,?,?,?,?)`).run(id, req.params.id, req.user.id, role_offer||'', message||'', portfolio_link||'');

  // Notify project owner immediately
  const interestUser = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id);
  pushNotif(project.owner_id, 'interest', `New interest in "${project.title}"`, `${interestUser.name} wants to collaborate as: ${role_offer||'collaborator'}`, `/projects/${project.id}`);

  // also broadcast via ws to owner
  const ownerWs = wsClients.get(project.owner_id);
  if (ownerWs && ownerWs.readyState === WebSocket.OPEN) {
    ownerWs.send(JSON.stringify({ event: 'new_interest', data: { project_id: req.params.id, project_title: project.title, user_name: interestUser.name, role_offer } }));
  }

  res.status(201).json({ id, status: 'pending' });
});

app.patch('/api/interests/:id', auth, (req, res) => {
  const interest = db.prepare(`SELECT i.*, p.owner_id, p.title as project_title FROM interests i JOIN projects p ON i.project_id=p.id WHERE i.id=?`).get(req.params.id);
  if (!interest) return res.status(404).json({ error: 'Not found' });
  if (interest.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const { status } = req.body;
  db.prepare(`UPDATE interests SET status=? WHERE id=?`).run(status, req.params.id);

  if (status === 'accepted') {
    // create a DM conversation between owner and collaborator
    const convId = uuid();
    db.prepare(`INSERT INTO conversations (id,type,project_id,name) VALUES (?,?,?,?)`).run(convId, 'direct', interest.project_id, '');
    db.prepare(`INSERT OR IGNORE INTO conv_members (conv_id,user_id) VALUES (?,?)`).run(convId, req.user.id);
    db.prepare(`INSERT OR IGNORE INTO conv_members (conv_id,user_id) VALUES (?,?)`).run(convId, interest.user_id);
    db.prepare(`INSERT INTO messages (id,conv_id,sender_id,type,content) VALUES (?,?,?,?,?)`).run(uuid(), convId, null, 'system', `Collaboration started on project: ${interest.project_title}`);
    // notify collaborator
    pushNotif(interest.user_id, 'accepted', 'Collaboration accepted!', `Your interest in "${interest.project_title}" was accepted. You can now message the project owner.`, `/messages/${convId}`);
  } else if (status === 'declined') {
    pushNotif(interest.user_id, 'declined', 'Interest update', `Your interest in "${interest.project_title}" was not accepted this time.`);
  }
  res.json({ ok: true, status });
});

// ─── MATCH ROUTES ─────────────────────────────────────────────────────────────
app.post('/api/matches', auth, (req, res) => {
  const { target_id, type } = req.body;
  if (target_id === req.user.id) return res.status(400).json({ error: 'Cannot match yourself' });
  const id = uuid();
  try {
    db.prepare(`INSERT INTO matches (id,user_a,user_b,type) VALUES (?,?,?,?)`).run(id, req.user.id, target_id, type||'connect');
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.json({ matched: false, alreadyExists: true });
  }
  // check if mutual
  const mutual = db.prepare(`SELECT * FROM matches WHERE user_a=? AND user_b=?`).get(target_id, req.user.id);
  let convId = null;
  if (mutual) {
    // upgrade both to matched, create DM
    db.prepare(`UPDATE matches SET status='matched' WHERE (user_a=? AND user_b=?) OR (user_a=? AND user_b=?)`).run(req.user.id, target_id, target_id, req.user.id);
    convId = uuid();
    db.prepare(`INSERT INTO conversations (id,type,name) VALUES (?,?,?)`).run(convId, 'direct', '');
    db.prepare(`INSERT OR IGNORE INTO conv_members (conv_id,user_id) VALUES (?,?)`).run(convId, req.user.id);
    db.prepare(`INSERT OR IGNORE INTO conv_members (conv_id,user_id) VALUES (?,?)`).run(convId, target_id);
    const me = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id);
    pushNotif(target_id, 'match', 'New Match!', `You and ${me.name} both want to connect. Start a conversation!`, `/messages/${convId}`);
  }
  res.json({ matched: !!mutual, conv_id: convId });
});

app.get('/api/matches/suggestions', auth, (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const myDisciplines = JSON.parse(me.disciplines || '[]');
  const seen = db.prepare(`SELECT user_b as id FROM matches WHERE user_a=? UNION SELECT user_a as id FROM matches WHERE user_b=?`).all(req.user.id, req.user.id).map(r => r.id);
  seen.push(req.user.id);
  const placeholders = seen.map(() => '?').join(',');
  const candidates = db.prepare(`SELECT id,name,name_np,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years,open_to_remote FROM users WHERE id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 20`).all(...seen);
  // simple match score
  const scored = candidates.map(u => {
    const theirD = JSON.parse(u.disciplines || '[]');
    const theirG = JSON.parse(u.genres || '[]');
    const myGenres = JSON.parse(me.genres || '[]');
    const overlap = theirG.filter(g => myGenres.includes(g)).length;
    const diffDiscipline = !myDisciplines.some(d => theirD.includes(d));
    const score = Math.min(99, 60 + overlap * 8 + (diffDiscipline ? 15 : 0) + (u.open_to_remote ? 5 : 0) + Math.floor(Math.random() * 12));
    return { ...u, match_score: score };
  });
  res.json(scored.sort((a,b) => b.match_score - a.match_score));
});

// ─── CONVERSATION / MESSAGE ROUTES ───────────────────────────────────────────
app.get('/api/conversations', auth, (req, res) => {
  const convs = db.prepare(`SELECT c.*, (SELECT content FROM messages WHERE conv_id=c.id ORDER BY created_at DESC LIMIT 1) as last_msg, (SELECT created_at FROM messages WHERE conv_id=c.id ORDER BY created_at DESC LIMIT 1) as last_time, (SELECT COUNT(*) FROM conv_members WHERE conv_id=c.id) as member_count FROM conversations c JOIN conv_members cm ON c.id=cm.conv_id WHERE cm.user_id=? ORDER BY last_time DESC`).all(req.user.id);
  for (const c of convs) {
    c.members = db.prepare(`SELECT u.id,u.name,u.avatar_init,u.avatar_color FROM conv_members cm JOIN users u ON cm.user_id=u.id WHERE cm.conv_id=?`).all(c.id);
  }
  res.json(convs);
});

app.get('/api/conversations/:id/messages', auth, (req, res) => {
  const member = db.prepare('SELECT * FROM conv_members WHERE conv_id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Not a member' });
  const msgs = db.prepare(`SELECT m.*, u.name as sender_name, u.avatar_init as sender_init FROM messages m LEFT JOIN users u ON m.sender_id=u.id WHERE m.conv_id=? ORDER BY m.created_at ASC`).all(req.params.id);
  res.json(msgs);
});

app.post('/api/conversations', auth, (req, res) => {
  const { target_user_id, project_id } = req.body;
  if (target_user_id) {
    const existing = db.prepare(`SELECT c.id FROM conversations c JOIN conv_members a ON c.id=a.conv_id AND a.user_id=? JOIN conv_members b ON c.id=b.conv_id AND b.user_id=? WHERE c.type='direct'`).get(req.user.id, target_user_id);
    if (existing) return res.json({ id: existing.id });
  }
  const id = uuid();
  db.prepare(`INSERT INTO conversations (id,type,project_id) VALUES (?,?,?)`).run(id, target_user_id ? 'direct' : 'group', project_id||null);
  db.prepare(`INSERT INTO conv_members (conv_id,user_id) VALUES (?,?)`).run(id, req.user.id);
  if (target_user_id) db.prepare(`INSERT OR IGNORE INTO conv_members (conv_id,user_id) VALUES (?,?)`).run(id, target_user_id);
  res.status(201).json({ id });
});

app.post('/api/conversations/group', auth, (req, res) => {
  const { name, member_ids, project_id } = req.body;
  const id = uuid();
  db.prepare(`INSERT INTO conversations (id,type,project_id,name) VALUES (?,?,?,?)`).run(id, 'group', project_id||null, name||'Group');
  const all = [req.user.id, ...(member_ids||[])];
  [...new Set(all)].forEach(uid => db.prepare(`INSERT OR IGNORE INTO conv_members (conv_id,user_id) VALUES (?,?)`).run(id, uid));
  db.prepare(`INSERT INTO messages (id,conv_id,sender_id,type,content) VALUES (?,?,?,?,?)`).run(uuid(), id, null, 'system', `Group "${name}" created`);
  res.status(201).json({ id });
});

// ─── EVENT ROUTES ─────────────────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  const evs = db.prepare(`SELECT e.*, u.name as creator_name, (SELECT COUNT(*) FROM rsvps WHERE event_id=e.id) as rsvp_count FROM events e LEFT JOIN users u ON e.creator_id=u.id ORDER BY e.event_date ASC`).all();
  res.json(evs);
});

app.post('/api/events', auth, (req, res) => {
  const { title, title_np, description, location, event_date, event_time, is_online, is_free, ticket_tiers, tags } = req.body;
  if (!title || !event_date) return res.status(400).json({ error: 'title and event_date required' });
  const id = uuid();
  db.prepare(`INSERT INTO events (id,creator_id,title,title_np,description,location,event_date,event_time,is_online,is_free,ticket_tiers,tags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, req.user.id, title, title_np||'', description||'', location||'', event_date, event_time||'', is_online?1:0, is_free?1:0, JSON.stringify(ticket_tiers||[]), JSON.stringify(tags||[]));
  res.status(201).json(db.prepare('SELECT * FROM events WHERE id=?').get(id));
});

app.post('/api/events/:id/rsvp', auth, (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Not found' });
  const { tier, qty } = req.body;
  const existing = db.prepare('SELECT * FROM rsvps WHERE event_id=? AND user_id=?').get(req.params.id, req.user.id);
  if (existing) return res.status(409).json({ error: 'Already RSVP\'d' });
  const id = uuid();
  db.prepare(`INSERT INTO rsvps (id,event_id,user_id,tier,qty) VALUES (?,?,?,?,?)`).run(id, req.params.id, req.user.id, tier||'general', qty||1);
  pushNotif(req.user.id, 'rsvp', `RSVP confirmed: ${ev.title}`, `You're attending on ${ev.event_date}`);
  res.status(201).json({ id });
});

// ─── PORTFOLIO ROUTES ─────────────────────────────────────────────────────────
app.get('/api/users/:id/portfolio', (req, res) => {
  res.json(db.prepare('SELECT * FROM portfolio_items WHERE user_id=? ORDER BY created_at DESC').all(req.params.id));
});

app.post('/api/portfolio', auth, (req, res) => {
  const { title, type, description, file_url, external_url } = req.body;
  if (!title || !type) return res.status(400).json({ error: 'title and type required' });
  const id = uuid();
  db.prepare(`INSERT INTO portfolio_items (id,user_id,title,type,description,file_url,external_url) VALUES (?,?,?,?,?,?,?)`).run(id, req.user.id, title, type, description||'', file_url||'', external_url||'');
  res.status(201).json(db.prepare('SELECT * FROM portfolio_items WHERE id=?').get(id));
});

// ─── NOTIFICATION ROUTES ──────────────────────────────────────────────────────
app.get('/api/notifications', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(req.user.id));
});

app.patch('/api/notifications/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});

// ─── FILE UPLOAD ──────────────────────────────────────────────────────────────
app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const ext = path.extname(req.file.originalname);
  const newName = uuid() + ext;
  const newPath = path.join(UPLOAD_DIR, newName);
  fs.renameSync(req.file.path, newPath);
  res.json({ url: `/uploads/${newName}`, name: req.file.originalname, size: req.file.size });
});

// ─── SEARCH ───────────────────────────────────────────────────────────────────
app.get('/api/search', (req, res) => {
  const q = `%${req.query.q||''}%`;
  const users = db.prepare('SELECT id,name,role,avatar_init,avatar_color FROM users WHERE name LIKE ? OR role LIKE ? LIMIT 5').all(q,q);
  const projects = db.prepare('SELECT id,title,type FROM projects WHERE title LIKE ? AND status="open" LIMIT 5').all(q);
  const events = db.prepare('SELECT id,title,event_date FROM events WHERE title LIKE ? LIMIT 5').all(q);
  res.json({ users, projects, events });
});

// ─── WebSocket server ─────────────────────────────────────────────────────────
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server, path: '/ws' });
const wsClients = new Map(); // userId -> ws

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  let userId = null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    userId = payload.id;
    wsClients.set(userId, ws);
  } catch { ws.close(); return; }

  ws.on('message', raw => {
    try {
      const { event, data } = JSON.parse(raw);
      if (event === 'message') {
        const { conv_id, content } = data;
        const member = db.prepare('SELECT * FROM conv_members WHERE conv_id=? AND user_id=?').get(conv_id, userId);
        if (!member) return;
        const id = uuid();
        db.prepare(`INSERT INTO messages (id,conv_id,sender_id,type,content) VALUES (?,?,?,?,?)`).run(id, conv_id, userId, 'text', content);
        const sender = db.prepare('SELECT name,avatar_init FROM users WHERE id=?').get(userId);
        const msg = { id, conv_id, sender_id: userId, sender_name: sender.name, sender_init: sender.avatar_init, type: 'text', content, created_at: new Date().toISOString() };
        // broadcast to all conv members
        const members = db.prepare('SELECT user_id FROM conv_members WHERE conv_id=?').all(conv_id);
        members.forEach(m => {
          const mws = wsClients.get(m.user_id);
          if (mws && mws.readyState === WebSocket.OPEN) {
            mws.send(JSON.stringify({ event: 'message', data: msg }));
          }
        });
      }
      if (event === 'ping') ws.send(JSON.stringify({ event: 'pong' }));
    } catch {}
  });

  ws.on('close', () => wsClients.delete(userId));
  ws.send(JSON.stringify({ event: 'connected', data: { userId } }));
});

// fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/index.html'));
});

server.listen(PORT, () => {
  console.log(`\n🌿 Kalachautari running on http://localhost:${PORT}`);
  console.log(`   Demo login: aasha@demo.com / demo1234\n`);
});
