server/index.js'use strict';

const express      = require('express');
const http         = require('http');
const WebSocket    = require('ws');
const path         = require('path');
const cors         = require('cors');
const jwt          = require('jsonwebtoken');
const bcrypt       = require('bcryptjs');
const multer       = require('multer');
const { v4: uuid } = require('uuid');
const fs           = require('fs');
const initSqlJs    = require('sql.js');

const JWT_SECRET   = process.env.JWT_SECRET   || 'kalachautari-secret-2025';
const ADMIN_SECRET = process.env.ADMIN_SECRET  || 'kalachautari-admin-2025';
const PORT         = process.env.PORT          || 3000;
const DB_PATH      = path.join(__dirname, '../data/kalachautari.db');
const UPLOAD_DIR   = path.join(__dirname, '../uploads');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let db;
function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function initDb(SQL) {
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }
  db.run2 = function(sql, params) { this.run(sql, params || []); return this; };
  db.get2  = function(sql, params) {
    const s = this.prepare(sql); s.bind(params || []);
    if (s.step()) { const r = s.getAsObject(); s.free(); return r; }
    s.free(); return undefined;
  };
  db.all2  = function(sql, params) {
    const r = [], s = this.prepare(sql); s.bind(params || []);
    while (s.step()) r.push(s.getAsObject()); s.free(); return r;
  };
  db.prepare2 = function(sql) {
    const self = this;
    return {
      run(...p) { self.run(sql, p.flat()); saveDb(); },
      get(...p) { return self.get2(sql, p.flat()); },
      all(...p) { return self.all2(sql, p.flat()); },
    };
  };
  setupSchema();
  const count = db.get2('SELECT COUNT(*) as c FROM users');
  if (!count || count.c === 0) seedDemo();
}

function setupSchema() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_np TEXT DEFAULT '', email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT DEFAULT '', bio TEXT DEFAULT '', bio_np TEXT DEFAULT '', location TEXT DEFAULT '', disciplines TEXT DEFAULT '[]', skills TEXT DEFAULT '[]', genres TEXT DEFAULT '[]', avatar_init TEXT DEFAULT '', avatar_color TEXT DEFAULT 'rust', portfolio_links TEXT DEFAULT '[]', open_to_remote INTEGER DEFAULT 1, experience_years INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, title_np TEXT DEFAULT '', type TEXT NOT NULL, description TEXT DEFAULT '', description_np TEXT DEFAULT '', roles_needed TEXT DEFAULT '[]', timeline TEXT DEFAULT '', location TEXT DEFAULT '', remote_ok INTEGER DEFAULT 1, experience_req TEXT DEFAULT 'Any', max_collaborators INTEGER DEFAULT 5, status TEXT DEFAULT 'open', media_links TEXT DEFAULT '[]', cover_url TEXT DEFAULT '', view_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS interests (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id TEXT NOT NULL, role_offer TEXT DEFAULT '', message TEXT DEFAULT '', portfolio_link TEXT DEFAULT '', status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, user_a TEXT NOT NULL, user_b TEXT NOT NULL, type TEXT DEFAULT 'connect', status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, type TEXT DEFAULT 'direct', project_id TEXT DEFAULT NULL, name TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS conv_members (conv_id TEXT NOT NULL, user_id TEXT NOT NULL, joined_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conv_id TEXT NOT NULL, sender_id TEXT DEFAULT NULL, type TEXT DEFAULT 'text', content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, creator_id TEXT DEFAULT NULL, title TEXT NOT NULL, title_np TEXT DEFAULT '', description TEXT DEFAULT '', location TEXT DEFAULT '', event_date TEXT NOT NULL, event_time TEXT DEFAULT '', is_online INTEGER DEFAULT 0, is_free INTEGER DEFAULT 1, ticket_tiers TEXT DEFAULT '[]', tags TEXT DEFAULT '[]', cover_url TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS rsvps (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT NOT NULL, tier TEXT DEFAULT 'general', qty INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS portfolio_items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, type TEXT NOT NULL, description TEXT DEFAULT '', file_url TEXT DEFAULT '', external_url TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT DEFAULT '', link TEXT DEFAULT '', read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`,
  ];
  tables.forEach(t => db.run(t));
  saveDb();
}

function seedDemo() {
  console.log('Seeding demo data...');
  const hash = bcrypt.hashSync('demo1234', 10);
  const users = [
    ['u1','Aasha Gurung','आशा गुरुङ','aasha@demo.com',hash,'Singer · Songwriter','Folk-influenced indie artist from Pokhara.','Pokhara','["musician"]','["Vocals","Songwriting","Production"]','["Folk Fusion","Indie Pop"]','आ','rust',7],
    ['u2','Bikash Magar','बिकाश मगर','bikash@demo.com',hash,'Filmmaker · Director','Documentary filmmaker. 5 films, 3 intl festivals.','Kathmandu','["filmmaker"]','["Direction","Cinematography"]','["Documentary","Short Film"]','बि','blue',7],
    ['u3','Mira Thapa','मीरा थापा','mira@demo.com',hash,'Poet · Writer','Writing in Nepali and English. 3 anthologies.','London, UK','["writer"]','["Poetry","Short Fiction"]','["Poetry","Literary Fiction"]','मी','gold',6],
    ['u4','Sujen Rai','सुजन राई','sujen@demo.com',hash,'Guitarist · Producer','Folk fusion and indie rock. Remote welcome.','Sydney, AU','["musician"]','["Guitar","Production","Mixing"]','["Folk Fusion","Indie Rock"]','सु','rust',10],
    ['u5','Anita Lama','अनिता लामा','anita@demo.com',hash,'Illustrator','Thangka-inspired illustration. Album covers.','Pokhara','["visual"]','["Illustration","Design"]','["Visual Art"]','अ','green',5],
    ['u6','Roshan Tamang','रोशन तामाङ','roshan@demo.com',hash,'Screenwriter · Director','Short film specialist.','Paris, FR','["filmmaker"]','["Screenwriting","Direction"]','["Short Film","Drama"]','रो','blue',6],
  ];
  users.forEach(u => db.run2(`INSERT OR IGNORE INTO users (id,name,name_np,email,password,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, u));

  const projects = [
    ['p1','u1','Himalaya EP','हिमालय EP','Music','6-track folk fusion EP. Remote welcome.','नेपाली लोक धुनसँग इन्डी EP।','["Tabla Player","Videographer","Mixing Engineer"]','3-6 months','Pokhara',1],
    ['p2','u6','Bato — Short Film','बाटो — छोटो फिल्म','Film','20-min narrative short about migration. Script ready.','प्रवासबारे छोटो फिल्म।','["Cinematographer","Sound Designer","Lead Actor"]','1-3 months','Kathmandu',0],
    ['p3','u3','Kavita Sangrah','कविता संग्रह','Literature','Bilingual poetry collection. Seeking illustrator.','द्विभाषी कविता संग्रह।','["Illustrator","Book Designer"]','1-3 months','Remote',1],
    ['p4','u5','Thangka Meets Beat','थाङ्का मिट्स बिट','Visual Art','Thangka art + electronic music project.','थाङ्का कला र इलेक्ट्रोनिक संगीत।','["Electronic Producer","Animator"]','Ongoing','Remote',1],
  ];
  projects.forEach(p => db.run2(`INSERT OR IGNORE INTO projects (id,owner_id,title,title_np,type,description,description_np,roles_needed,timeline,location,remote_ok) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, p));

  const events = [
    ['e1','u1','Kala Saanjh — Open Mic','कला साँझ — ओपन माइक','Monthly open mic for Nepali creatives','Patan Dhoka, Lalitpur','2026-03-22','17:00',0,1,'["Music","Poetry","Free"]','[{"name":"General","price":0,"desc":"Open floor"},{"name":"Supporter","price":500,"desc":"Reserved seat"}]'],
    ['e2','u2','Diaspora Creatives Meetup','डायस्पोरा भेट','Networking for Nepali creatives in London','Nepal Centre, London','2026-04-05','15:00',0,0,'["Networking","All Arts"]','[{"name":"General","price":0,"desc":"Walk-in"},{"name":"VIP","price":1500,"desc":"Dinner included"}]'],
    ['e3','u6','Short Film Workshop','लघु फिल्म कार्यशाला','Online cinematography masterclass','Online (Zoom)','2026-04-18','18:00',1,0,'["Film","Workshop"]','[{"name":"Early Bird","price":500,"desc":"Limited"},{"name":"Standard","price":800,"desc":"Full access"}]'],
  ];
  events.forEach(e => db.run2(`INSERT OR IGNORE INTO events (id,creator_id,title,title_np,description,location,event_date,event_time,is_online,is_free,tags,ticket_tiers) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, e));

  db.run2(`INSERT OR IGNORE INTO conversations (id,type,project_id,name) VALUES (?,?,?,?)`, ['c1','group','p1','Himalaya EP — Team']);
  ['u1','u2','u4'].forEach(uid => db.run2(`INSERT OR IGNORE INTO conv_members (conv_id,user_id) VALUES (?,?)`, ['c1',uid]));
  db.run2(`INSERT OR IGNORE INTO messages (id,conv_id,sender_id,type,content) VALUES (?,?,?,?,?)`, [uuid(),'c1',null,'system','Group created: Himalaya EP Collaboration']);
  db.run2(`INSERT OR IGNORE INTO messages (id,conv_id,sender_id,type,content) VALUES (?,?,?,?,?)`, [uuid(),'c1','u2','text','Great session yesterday everyone!']);
  saveDb();
  console.log('Demo seeded. Login: aasha@demo.com / demo1234');
}

// ─── Middleware ───────────────────────────────────────────────────────────────
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(h.replace('Bearer ',''), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}
function optAuth(req, res, next) {
  const h = req.headers.authorization;
  if (h) { try { req.user = jwt.verify(h.replace('Bearer ',''), JWT_SECRET); } catch {} }
  next();
}
function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
  next();
}

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, '../client/public')));
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 100 * 1024 * 1024 } });
const wsClients = new Map();

function pushNotif(userId, type, title, body='', link='') {
  db.run2(`INSERT INTO notifications (id,user_id,type,title,body,link) VALUES (?,?,?,?,?,?)`, [uuid(),userId,type,title,body,link]);
  saveDb();
  const ws = wsClients.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ event:'notification', data:{type,title,body,link} }));
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, role, location, disciplines } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error:'Missing fields' });
  if (db.get2('SELECT id FROM users WHERE email=?', [email])) return res.status(409).json({ error:'Email already registered' });
  const id = uuid(), hash = bcrypt.hashSync(password, 10);
  const colors = ['rust','blue','gold','green'];
  db.run2(`INSERT INTO users (id,name,email,password,role,location,disciplines,avatar_init,avatar_color) VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, name, email, hash, role||'', location||'', JSON.stringify(disciplines||[]), name.charAt(0).toUpperCase(), colors[Math.floor(Math.random()*4)]]);
  saveDb();
  const token = jwt.sign({id,name,email}, JWT_SECRET, {expiresIn:'30d'});
  res.json({ token, user: db.get2('SELECT id,name,name_np,email,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years,open_to_remote FROM users WHERE id=?', [id]) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.get2('SELECT * FROM users WHERE email=?', [email]);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error:'Invalid credentials' });
  const token = jwt.sign({id:user.id, name:user.name, email:user.email}, JWT_SECRET, {expiresIn:'30d'});
  const safe = {...user}; delete safe.password;
  res.json({ token, user: safe });
});

// ─── USERS ────────────────────────────────────────────────────────────────────
app.get('/api/users', optAuth, (req, res) => {
  const { type, search } = req.query;
  let sql = `SELECT id,name,name_np,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years,open_to_remote,created_at FROM users WHERE 1=1`;
  const p = [];
  if (type)   { sql += ` AND disciplines LIKE ?`; p.push(`%${type}%`); }
  if (search) { sql += ` AND (name LIKE ? OR role LIKE ? OR skills LIKE ?)`; p.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  res.json(db.all2(sql + ` ORDER BY created_at DESC`, p));
});

app.get('/api/users/:id', (req, res) => {
  const u = db.get2('SELECT id,name,name_np,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years,open_to_remote,created_at FROM users WHERE id=?', [req.params.id]);
  if (!u) return res.status(404).json({ error:'Not found' });
  u.projects  = db.all2('SELECT id,title,type,status FROM projects WHERE owner_id=? AND status="open"', [req.params.id]);
  u.portfolio = db.all2('SELECT * FROM portfolio_items WHERE user_id=? ORDER BY created_at DESC', [req.params.id]);
  res.json(u);
});

app.patch('/api/users/me', auth, (req, res) => {
  const { name, name_np, role, bio, bio_np, location, disciplines, skills, genres, experience_years, open_to_remote } = req.body;
  db.run2(`UPDATE users SET name=COALESCE(?,name),name_np=COALESCE(?,name_np),role=COALESCE(?,role),bio=COALESCE(?,bio),bio_np=COALESCE(?,bio_np),location=COALESCE(?,location),disciplines=COALESCE(?,disciplines),skills=COALESCE(?,skills),genres=COALESCE(?,genres),experience_years=COALESCE(?,experience_years),open_to_remote=COALESCE(?,open_to_remote) WHERE id=?`,
    [name,name_np,role,bio,bio_np,location,disciplines?JSON.stringify(disciplines):null,skills?JSON.stringify(skills):null,genres?JSON.stringify(genres):null,experience_years,open_to_remote!==undefined?(open_to_remote?1:0):null,req.user.id]);
  saveDb();
  res.json(db.get2('SELECT id,name,name_np,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years,open_to_remote FROM users WHERE id=?', [req.user.id]));
});

// ─── PROJECTS ─────────────────────────────────────────────────────────────────
app.get('/api/projects', optAuth, (req, res) => {
  const { type, remote, search, status } = req.query;
  let sql = `SELECT p.*,u.name as owner_name,u.avatar_init as owner_init,u.avatar_color as owner_color,(SELECT COUNT(*) FROM interests WHERE project_id=p.id) as interest_count FROM projects p JOIN users u ON p.owner_id=u.id WHERE 1=1`;
  const p = [];
  sql += status ? ` AND p.status=?` : ` AND p.status='open'`;
  if (status) p.push(status);
  if (type)   { sql += ` AND p.type=?`; p.push(type); }
  if (remote==='1') sql += ` AND p.remote_ok=1`;
  if (search) { sql += ` AND (p.title LIKE ? OR p.description LIKE ?)`; p.push(`%${search}%`,`%${search}%`); }
  res.json(db.all2(sql + ` ORDER BY p.created_at DESC`, p));
});

app.get('/api/projects/:id', optAuth, (req, res) => {
  const p = db.get2(`SELECT p.*,u.name as owner_name,u.avatar_init as owner_init,u.avatar_color as owner_color,(SELECT COUNT(*) FROM interests WHERE project_id=p.id) as interest_count FROM projects p JOIN users u ON p.owner_id=u.id WHERE p.id=?`, [req.params.id]);
  if (!p) return res.status(404).json({ error:'Not found' });
  db.run2(`UPDATE projects SET view_count=view_count+1 WHERE id=?`, [req.params.id]); saveDb();
  if (req.user) p.my_interest = db.get2('SELECT * FROM interests WHERE project_id=? AND user_id=?', [req.params.id, req.user.id]);
  res.json(p);
});

app.post('/api/projects', auth, (req, res) => {
  const { title,title_np,type,description,description_np,roles_needed,timeline,location,remote_ok,experience_req,max_collaborators,media_links,cover_url } = req.body;
  if (!title||!type) return res.status(400).json({ error:'title and type required' });
  const id = uuid();
  db.run2(`INSERT INTO projects (id,owner_id,title,title_np,type,description,description_np,roles_needed,timeline,location,remote_ok,experience_req,max_collaborators,media_links,cover_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,req.user.id,title,title_np||'',type,description||'',description_np||'',JSON.stringify(roles_needed||[]),timeline||'',location||'',remote_ok?1:0,experience_req||'Any',max_collaborators||5,JSON.stringify(media_links||[]),cover_url||'']);
  saveDb();
  res.status(201).json(db.get2('SELECT p.*,u.name as owner_name,u.avatar_init as owner_init FROM projects p JOIN users u ON p.owner_id=u.id WHERE p.id=?', [id]));
});

app.patch('/api/projects/:id', auth, (req, res) => {
  const p = db.get2('SELECT * FROM projects WHERE id=?', [req.params.id]);
  if (!p) return res.status(404).json({ error:'Not found' });
  if (p.owner_id!==req.user.id) return res.status(403).json({ error:'Forbidden' });
  const { title,description,status,roles_needed } = req.body;
  db.run2(`UPDATE projects SET title=COALESCE(?,title),description=COALESCE(?,description),status=COALESCE(?,status),roles_needed=COALESCE(?,roles_needed) WHERE id=?`,
    [title,description,status,roles_needed?JSON.stringify(roles_needed):null,req.params.id]);
  saveDb(); res.json(db.get2('SELECT * FROM projects WHERE id=?', [req.params.id]));
});

// ─── INTERESTS ────────────────────────────────────────────────────────────────
app.get('/api/projects/:id/interests', auth, (req, res) => {
  const p = db.get2('SELECT * FROM projects WHERE id=?', [req.params.id]);
  if (!p) return res.status(404).json({ error:'Not found' });
  if (p.owner_id!==req.user.id) return res.status(403).json({ error:'Forbidden' });
  res.json(db.all2(`SELECT i.*,u.name,u.name_np,u.role,u.avatar_init,u.avatar_color,u.location,u.skills FROM interests i JOIN users u ON i.user_id=u.id WHERE i.project_id=? ORDER BY i.created_at DESC`, [req.params.id]));
});

app.post('/api/projects/:id/interest', auth, (req, res) => {
  const project = db.get2('SELECT * FROM projects WHERE id=?', [req.params.id]);
  if (!project) return res.status(404).json({ error:'Project not found' });
  if (project.owner_id===req.user.id) return res.status(400).json({ error:'Cannot express interest in your own project' });
  if (db.get2('SELECT id FROM interests WHERE project_id=? AND user_id=?', [req.params.id, req.user.id])) return res.status(409).json({ error:'Already expressed interest' });
  const { role_offer, message, portfolio_link } = req.body;
  const id = uuid();
  db.run2(`INSERT INTO interests (id,project_id,user_id,role_offer,message,portfolio_link) VALUES (?,?,?,?,?,?)`, [id,req.params.id,req.user.id,role_offer||'',message||'',portfolio_link||'']);
  saveDb();
  const iUser = db.get2('SELECT name FROM users WHERE id=?', [req.user.id]);
  pushNotif(project.owner_id, 'interest', `New interest in "${project.title}"`, `${iUser.name} wants to collaborate as: ${role_offer||'collaborator'}`, `/projects/${req.params.id}`);
  const ownerWs = wsClients.get(project.owner_id);
  if (ownerWs && ownerWs.readyState===WebSocket.OPEN)
    ownerWs.send(JSON.stringify({ event:'new_interest', data:{project_id:req.params.id,project_title:project.title,user_name:iUser.name,role_offer} }));
  res.status(201).json({ id, status:'pending' });
});

app.patch('/api/interests/:id', auth, (req, res) => {
  const interest = db.get2(`SELECT i.*,p.owner_id,p.title as project_title FROM interests i JOIN projects p ON i.project_id=p.id WHERE i.id=?`, [req.params.id]);
  if (!interest) return res.status(404).json({ error:'Not found' });
  if (interest.owner_id!==req.user.id) return res.status(403).json({ error:'Forbidden' });
  const { status } = req.body;
  db.run2(`UPDATE interests SET status=? WHERE id=?`, [status, req.params.id]); saveDb();
  if (status==='accepted') {
    const convId = uuid();
    db.run2(`INSERT INTO conversations (id,type,project_id,name) VALUES (?,?,?,?)`, [convId,'direct',interest.project_id,'']);
    db.run2(`INSERT INTO conv_members (conv_id,user_id) VALUES (?,?)`, [convId,req.user.id]);
    db.run2(`INSERT INTO conv_members (conv_id,user_id) VALUES (?,?)`, [convId,interest.user_id]);
    db.run2(`INSERT INTO messages (id,conv_id,sender_id,type,content) VALUES (?,?,?,?,?)`, [uuid(),convId,null,'system',`Collaboration started on: ${interest.project_title}`]);
    saveDb();
    pushNotif(interest.user_id, 'accepted', 'Collaboration accepted!', `Your interest in "${interest.project_title}" was accepted.`, `/messages/${convId}`);
  } else if (status==='declined') {
    pushNotif(interest.user_id, 'declined', 'Interest update', `Your interest in "${interest.project_title}" was reviewed.`);
  }
  res.json({ ok:true, status });
});

// ─── MATCHES ──────────────────────────────────────────────────────────────────
app.post('/api/matches', auth, (req, res) => {
  const { target_id, type } = req.body;
  if (target_id===req.user.id) return res.status(400).json({ error:'Cannot match yourself' });
  if (db.get2('SELECT id FROM matches WHERE user_a=? AND user_b=?', [req.user.id,target_id])) return res.json({ matched:false, alreadyExists:true });
  db.run2(`INSERT INTO matches (id,user_a,user_b,type) VALUES (?,?,?,?)`, [uuid(),req.user.id,target_id,type||'connect']); saveDb();
  const mutual = db.get2(`SELECT id FROM matches WHERE user_a=? AND user_b=?`, [target_id,req.user.id]);
  let convId = null;
  if (mutual) {
    db.run2(`UPDATE matches SET status='matched' WHERE (user_a=? AND user_b=?) OR (user_a=? AND user_b=?)`, [req.user.id,target_id,target_id,req.user.id]);
    convId = uuid();
    db.run2(`INSERT INTO conversations (id,type,name) VALUES (?,?,?)`, [convId,'direct','']);
    db.run2(`INSERT INTO conv_members (conv_id,user_id) VALUES (?,?)`, [convId,req.user.id]);
    db.run2(`INSERT INTO conv_members (conv_id,user_id) VALUES (?,?)`, [convId,target_id]);
    saveDb();
    const me = db.get2('SELECT name FROM users WHERE id=?', [req.user.id]);
    pushNotif(target_id, 'match', 'New Match!', `You and ${me.name} both want to connect!`, `/messages/${convId}`);
  }
  res.json({ matched:!!mutual, conv_id:convId });
});

app.get('/api/matches/suggestions', auth, (req, res) => {
  const me = db.get2('SELECT * FROM users WHERE id=?', [req.user.id]);
  const seen = db.all2(`SELECT user_b as id FROM matches WHERE user_a=? UNION SELECT user_a as id FROM matches WHERE user_b=?`, [req.user.id,req.user.id]).map(r=>r.id);
  seen.push(req.user.id);
  const ph = seen.map(()=>'?').join(',');
  const candidates = db.all2(`SELECT id,name,name_np,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years,open_to_remote FROM users WHERE id NOT IN (${ph}) ORDER BY RANDOM() LIMIT 20`, seen);
  const myGenres = JSON.parse(me.genres||'[]'), myDisc = JSON.parse(me.disciplines||'[]');
  const scored = candidates.map(u => {
    const overlap = JSON.parse(u.genres||'[]').filter(g=>myGenres.includes(g)).length;
    const diff = !myDisc.some(d=>JSON.parse(u.disciplines||'[]').includes(d));
    return { ...u, match_score: Math.min(99, 60+overlap*8+(diff?15:0)+(u.open_to_remote?5:0)+Math.floor(Math.random()*12)) };
  });
  res.json(scored.sort((a,b)=>b.match_score-a.match_score));
});

// ─── CONVERSATIONS ────────────────────────────────────────────────────────────
app.get('/api/conversations', auth, (req, res) => {
  const convs = db.all2(`SELECT c.*,(SELECT content FROM messages WHERE conv_id=c.id ORDER BY created_at DESC LIMIT 1) as last_msg,(SELECT created_at FROM messages WHERE conv_id=c.id ORDER BY created_at DESC LIMIT 1) as last_time,(SELECT COUNT(*) FROM conv_members WHERE conv_id=c.id) as member_count FROM conversations c JOIN conv_members cm ON c.id=cm.conv_id WHERE cm.user_id=? ORDER BY last_time DESC`, [req.user.id]);
  convs.forEach(c => { c.members = db.all2(`SELECT u.id,u.name,u.avatar_init,u.avatar_color FROM conv_members cm JOIN users u ON cm.user_id=u.id WHERE cm.conv_id=?`, [c.id]); });
  res.json(convs);
});

app.get('/api/conversations/:id/messages', auth, (req, res) => {
  if (!db.get2('SELECT conv_id FROM conv_members WHERE conv_id=? AND user_id=?', [req.params.id,req.user.id])) return res.status(403).json({ error:'Not a member' });
  res.json(db.all2(`SELECT m.*,u.name as sender_name,u.avatar_init as sender_init FROM messages m LEFT JOIN users u ON m.sender_id=u.id WHERE m.conv_id=? ORDER BY m.created_at ASC`, [req.params.id]));
});

app.post('/api/conversations', auth, (req, res) => {
  const { target_user_id, project_id } = req.body;
  if (target_user_id) {
    const ex = db.get2(`SELECT c.id FROM conversations c JOIN conv_members a ON c.id=a.conv_id AND a.user_id=? JOIN conv_members b ON c.id=b.conv_id AND b.user_id=? WHERE c.type='direct'`, [req.user.id,target_user_id]);
    if (ex) return res.json({ id:ex.id });
  }
  const id = uuid();
  db.run2(`INSERT INTO conversations (id,type,project_id) VALUES (?,?,?)`, [id,target_user_id?'direct':'group',project_id||null]);
  db.run2(`INSERT INTO conv_members (conv_id,user_id) VALUES (?,?)`, [id,req.user.id]);
  if (target_user_id) db.run2(`INSERT OR IGNORE INTO conv_members (conv_id,user_id) VALUES (?,?)`, [id,target_user_id]);
  saveDb(); res.status(201).json({ id });
});

// ─── EVENTS ───────────────────────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  res.json(db.all2(`SELECT e.*,u.name as creator_name,(SELECT COUNT(*) FROM rsvps WHERE event_id=e.id) as rsvp_count FROM events e LEFT JOIN users u ON e.creator_id=u.id ORDER BY e.event_date ASC`));
});

app.post('/api/events', auth, (req, res) => {
  const { title,title_np,description,location,event_date,event_time,is_online,is_free,ticket_tiers,tags } = req.body;
  if (!title||!event_date) return res.status(400).json({ error:'title and event_date required' });
  const id = uuid();
  db.run2(`INSERT INTO events (id,creator_id,title,title_np,description,location,event_date,event_time,is_online,is_free,ticket_tiers,tags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,req.user.id,title,title_np||'',description||'',location||'',event_date,event_time||'',is_online?1:0,is_free?1:0,JSON.stringify(ticket_tiers||[]),JSON.stringify(tags||[])]);
  saveDb(); res.status(201).json(db.get2('SELECT * FROM events WHERE id=?', [id]));
});

app.post('/api/events/:id/rsvp', auth, (req, res) => {
  const ev = db.get2('SELECT * FROM events WHERE id=?', [req.params.id]);
  if (!ev) return res.status(404).json({ error:'Not found' });
  if (db.get2('SELECT id FROM rsvps WHERE event_id=? AND user_id=?', [req.params.id,req.user.id])) return res.status(409).json({ error:"Already RSVP'd" });
  const id = uuid();
  db.run2(`INSERT INTO rsvps (id,event_id,user_id,tier,qty) VALUES (?,?,?,?,?)`, [id,req.params.id,req.user.id,req.body.tier||'general',req.body.qty||1]);
  saveDb();
  pushNotif(req.user.id, 'rsvp', `RSVP confirmed: ${ev.title}`, `You're attending on ${ev.event_date}`);
  res.status(201).json({ id });
});

// ─── PORTFOLIO ────────────────────────────────────────────────────────────────
app.get('/api/users/:id/portfolio', (req, res) => {
  res.json(db.all2('SELECT * FROM portfolio_items WHERE user_id=? ORDER BY created_at DESC', [req.params.id]));
});
app.post('/api/portfolio', auth, (req, res) => {
  const { title,type,description,file_url,external_url } = req.body;
  if (!title||!type) return res.status(400).json({ error:'title and type required' });
  const id = uuid();
  db.run2(`INSERT INTO portfolio_items (id,user_id,title,type,description,file_url,external_url) VALUES (?,?,?,?,?,?,?)`, [id,req.user.id,title,type,description||'',file_url||'',external_url||'']);
  saveDb(); res.status(201).json(db.get2('SELECT * FROM portfolio_items WHERE id=?', [id]));
});

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
app.get('/api/notifications', auth, (req, res) => {
  res.json(db.all2('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50', [req.user.id]));
});
app.patch('/api/notifications/read', auth, (req, res) => {
  db.run2('UPDATE notifications SET read=1 WHERE user_id=?', [req.user.id]); saveDb(); res.json({ ok:true });
});

// ─── SEARCH ───────────────────────────────────────────────────────────────────
app.get('/api/search', (req, res) => {
  const q = `%${req.query.q||''}%`;
  res.json({
    users:    db.all2('SELECT id,name,role,avatar_init,avatar_color FROM users WHERE name LIKE ? OR role LIKE ? LIMIT 5', [q,q]),
    projects: db.all2('SELECT id,title,type FROM projects WHERE title LIKE ? AND status="open" LIMIT 5', [q]),
    events:   db.all2('SELECT id,title,event_date FROM events WHERE title LIKE ? LIMIT 5', [q]),
  });
});

// ─── UPLOAD ───────────────────────────────────────────────────────────────────
app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error:'No file' });
  const newName = uuid() + path.extname(req.file.originalname);
  fs.renameSync(req.file.path, path.join(UPLOAD_DIR, newName));
  res.json({ url:`/uploads/${newName}`, name:req.file.originalname, size:req.file.size });
});

// ─── ADMIN ────────────────────────────────────────────────────────────────────
app.get('/admin', adminAuth, (req, res) => {
  const key = req.query.key || ADMIN_SECRET;
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Kalachautari Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Mukta:wght@400;600;700&family=Yatra+One&display=swap" rel="stylesheet"/>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Mukta',sans-serif;background:#1A0F08;color:#F4ECD8}nav{background:#0F0804;border-bottom:3px solid #C9922A;padding:0 2rem;height:54px;display:flex;align-items:center;gap:1rem}nav h1{font-family:'Yatra One',serif;color:#C9922A;font-size:1.2rem}.tabs{display:flex;background:#140A05;border-bottom:1px solid rgba(255,255,255,0.08);padding:0 2rem}.tab{background:none;border:none;color:rgba(255,255,255,0.5);padding:12px 18px;cursor:pointer;font-family:'Mukta',sans-serif;font-size:0.82rem;border-bottom:2px solid transparent}.tab.act{color:#C9922A;border-bottom-color:#C9922A;font-weight:700}.pg{display:none;padding:2rem}.pg.act{display:block}table{width:100%;border-collapse:collapse;font-size:0.82rem}th{text-align:left;padding:8px 12px;font-size:0.68rem;text-transform:uppercase;color:rgba(255,255,255,0.4);border-bottom:1px solid rgba(255,255,255,0.08)}td{padding:9px 12px;border-bottom:1px solid rgba(255,255,255,0.05);vertical-align:top}tr:hover td{background:rgba(255,255,255,0.03)}.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:0.68rem;font-weight:700}.open{background:#1A4D2A;color:#6FCF97}.pending{background:#412402;color:#F0B86A}.accepted{background:#1A4D2A;color:#6FCF97}.closed{background:#4A1B0C;color:#F08070}.stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:2rem}.stat{background:#0F0804;border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:1.25rem;text-align:center}.stat-n{font-family:'Yatra One',serif;font-size:2rem;color:#C9922A}.stat-l{font-size:0.68rem;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin-top:3px}.sec{font-family:'Yatra One',serif;font-size:1.1rem;color:#C9922A;margin-bottom:1rem}input.srch{background:#0F0804;border:1px solid rgba(255,255,255,0.1);border-radius:3px;padding:6px 12px;color:#F4ECD8;font-family:'Mukta',sans-serif;font-size:0.82rem;width:280px;margin-bottom:1rem}.btn{background:#B8432F;color:#fff;border:none;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:0.72rem;font-weight:700}.btn.d{background:#4A1B0C}.prev{max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(255,255,255,0.55);font-size:0.75rem}#toast{position:fixed;bottom:1.5rem;right:1.5rem;background:#C9922A;color:#1A0F08;padding:10px 16px;border-radius:4px;font-size:0.82rem;font-weight:700;opacity:0;transition:opacity 0.3s;pointer-events:none}#toast.show{opacity:1}</style></head><body>
<nav><h1>कलाचौतारी Admin</h1><span style="color:rgba(255,255,255,0.4);font-size:0.75rem">Platform Management</span></nav>
<div class="tabs">
  <button class="tab act" onclick="showTab('dashboard',this)">Dashboard</button>
  <button class="tab" onclick="showTab('users',this)">Users</button>
  <button class="tab" onclick="showTab('projects',this)">Projects</button>
  <button class="tab" onclick="showTab('interests',this)">Interests</button>
  <button class="tab" onclick="showTab('messages',this)">Messages</button>
  <button class="tab" onclick="showTab('events',this)">Events</button>
</div>
<div id="pg-dashboard" class="pg act"><div class="stat-row" id="stats"></div><div class="sec">Recent Signups</div><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Location</th><th>Joined</th></tr></thead><tbody id="ru"></tbody></table></div>
<div id="pg-users" class="pg"><input class="srch" placeholder="Search users..." oninput="filt('ut',this.value)"/><table id="ut"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Location</th><th>Disciplines</th><th>Exp</th><th>Joined</th><th></th></tr></thead><tbody id="ub"></tbody></table></div>
<div id="pg-projects" class="pg"><table><thead><tr><th>Title</th><th>Type</th><th>Owner</th><th>Remote</th><th>Interests</th><th>Status</th><th>Posted</th><th></th></tr></thead><tbody id="pb"></tbody></table></div>
<div id="pg-interests" class="pg"><table><thead><tr><th>Project</th><th>Applicant</th><th>Email</th><th>Role Offer</th><th>Message</th><th>Portfolio</th><th>Status</th><th>Date</th></tr></thead><tbody id="ib"></tbody></table></div>
<div id="pg-messages" class="pg"><table><thead><tr><th>Conversation</th><th>Type</th><th>Members</th><th>Last Message</th><th>Total</th><th>Created</th></tr></thead><tbody id="mb"></tbody></table></div>
<div id="pg-events" class="pg"><table><thead><tr><th>Title</th><th>Date</th><th>Location</th><th>Creator</th><th>Free?</th><th>RSVPs</th><th></th></tr></thead><tbody id="eb"></tbody></table></div>
<div id="toast"></div>
<script>
const K='${key}',H={'x-admin-key':K,'Content-Type':'application/json'};
function fmt(d){return d?new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'}):'—'}
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000)}
function filt(id,q){document.querySelectorAll('#'+id+' tbody tr').forEach(r=>{r.style.display=r.textContent.toLowerCase().includes(q.toLowerCase())?'':'none'})}
async function showTab(t,btn){document.querySelectorAll('.pg').forEach(p=>p.classList.remove('act'));document.querySelectorAll('.tab').forEach(b=>b.classList.remove('act'));document.getElementById('pg-'+t).classList.add('act');btn.classList.add('act');if(t==='dashboard')await lDash();if(t==='users')await lUsers();if(t==='projects')await lProj();if(t==='interests')await lInt();if(t==='messages')await lMsgs();if(t==='events')await lEvs()}
async function lDash(){const[u,p,e,i]=await Promise.all([fetch('/api/admin/users',{headers:H}).then(r=>r.json()),fetch('/api/admin/projects',{headers:H}).then(r=>r.json()),fetch('/api/admin/events',{headers:H}).then(r=>r.json()),fetch('/api/admin/interests',{headers:H}).then(r=>r.json())]);document.getElementById('stats').innerHTML=[{n:u.length,l:'Users'},{n:p.filter(x=>x.status==='open').length,l:'Open Projects'},{n:i.filter(x=>x.status==='pending').length,l:'Pending Interests'},{n:e.length,l:'Events'}].map(s=>'<div class="stat"><div class="stat-n">'+s.n+'</div><div class="stat-l">'+s.l+'</div></div>').join('');document.getElementById('ru').innerHTML=u.slice(0,10).map(x=>'<tr><td>'+x.name+'</td><td style="color:#C9922A">'+x.email+'</td><td>'+(x.role||'—')+'</td><td>'+(x.location||'—')+'</td><td>'+fmt(x.created_at)+'</td></tr>').join('')}
async function lUsers(){const u=await fetch('/api/admin/users',{headers:H}).then(r=>r.json());document.getElementById('ub').innerHTML=u.map(x=>'<tr><td><strong>'+x.name+'</strong></td><td style="color:#C9922A">'+x.email+'</td><td>'+(x.role||'—')+'</td><td>'+(x.location||'—')+'</td><td>'+(JSON.parse(x.disciplines||'[]').join(', ')||'—')+'</td><td>'+(x.experience_years||0)+'yr</td><td>'+fmt(x.created_at)+'</td><td><button class="btn d" onclick="dUser(\''+x.id+'\',\''+x.name.replace(/'/g,"\\'")+'\')" >Delete</button></td></tr>').join('')}
async function lProj(){const p=await fetch('/api/admin/projects',{headers:H}).then(r=>r.json());document.getElementById('pb').innerHTML=p.map(x=>'<tr><td><strong>'+x.title+'</strong></td><td>'+x.type+'</td><td>'+(x.owner_name||'?')+'</td><td>'+(x.remote_ok?'✓':'✗')+'</td><td>'+(x.interest_count||0)+'</td><td><span class="badge '+x.status+'">'+x.status+'</span></td><td>'+fmt(x.created_at)+'</td><td><button class="btn d" onclick="cProj(\''+x.id+'\')">Close</button></td></tr>').join('')}
async function lInt(){const i=await fetch('/api/admin/interests',{headers:H}).then(r=>r.json());document.getElementById('ib').innerHTML=i.map(x=>'<tr><td>'+(x.project_title||'?')+'</td><td><strong>'+(x.user_name||'?')+'</strong></td><td style="color:#C9922A">'+(x.user_email||'')+'</td><td>'+(x.role_offer||'—')+'</td><td class="prev">'+(x.message||'—')+'</td><td>'+(x.portfolio_link?'<a href="'+x.portfolio_link+'" target="_blank" style="color:#C9922A">Link</a>':'—')+'</td><td><span class="badge '+(x.status||'pending')+'">'+(x.status||'pending')+'</span></td><td>'+fmt(x.created_at)+'</td></tr>').join('')}
async function lMsgs(){const c=await fetch('/api/admin/conversations',{headers:H}).then(r=>r.json());document.getElementById('mb').innerHTML=c.map(x=>'<tr><td>'+(x.name||(x.type==='direct'?'Direct':'Group'))+'</td><td>'+x.type+'</td><td>'+(x.member_count||0)+'</td><td class="prev">'+(x.last_msg||'—')+'</td><td>'+(x.msg_count||0)+'</td><td>'+fmt(x.created_at)+'</td></tr>').join('')}
async function lEvs(){const e=await fetch('/api/admin/events',{headers:H}).then(r=>r.json());document.getElementById('eb').innerHTML=e.map(x=>'<tr><td><strong>'+x.title+'</strong></td><td>'+x.event_date+'</td><td>'+(x.location||'—')+'</td><td>'+(x.creator_name||'?')+'</td><td>'+(x.is_free?'Free':'Paid')+'</td><td>'+(x.rsvp_count||0)+'</td><td><button class="btn d" onclick="dEv(\''+x.id+'\')">Delete</button></td></tr>').join('')}
async function dUser(id,name){if(!confirm('Delete '+name+'?'))return;await fetch('/api/admin/users/'+id,{method:'DELETE',headers:H});toast('Deleted');lUsers()}
async function cProj(id){await fetch('/api/admin/projects/'+id+'/close',{method:'PATCH',headers:H});toast('Closed');lProj()}
async function dEv(id){if(!confirm('Delete?'))return;await fetch('/api/admin/events/'+id,{method:'DELETE',headers:H});toast('Deleted');lEvs()}
lDash();
</script></body></html>`);
});

app.get('/api/admin/users',        adminAuth, (req,res)=>res.json(db.all2('SELECT id,name,name_np,email,role,location,disciplines,skills,experience_years,avatar_init,created_at FROM users ORDER BY created_at DESC')));
app.delete('/api/admin/users/:id', adminAuth, (req,res)=>{ db.run2('DELETE FROM users WHERE id=?',[req.params.id]); saveDb(); res.json({ok:true}); });
app.get('/api/admin/projects',     adminAuth, (req,res)=>res.json(db.all2(`SELECT p.*,u.name as owner_name,(SELECT COUNT(*) FROM interests WHERE project_id=p.id) as interest_count FROM projects p LEFT JOIN users u ON p.owner_id=u.id ORDER BY p.created_at DESC`)));
app.patch('/api/admin/projects/:id/close', adminAuth, (req,res)=>{ db.run2('UPDATE projects SET status=? WHERE id=?',['closed',req.params.id]); saveDb(); res.json({ok:true}); });
app.get('/api/admin/interests',    adminAuth, (req,res)=>res.json(db.all2(`SELECT i.*,p.title as project_title,u.name as user_name,u.email as user_email FROM interests i LEFT JOIN projects p ON i.project_id=p.id LEFT JOIN users u ON i.user_id=u.id ORDER BY i.created_at DESC`)));
app.get('/api/admin/conversations',adminAuth, (req,res)=>res.json(db.all2(`SELECT c.*,(SELECT COUNT(*) FROM conv_members WHERE conv_id=c.id) as member_count,(SELECT COUNT(*) FROM messages WHERE conv_id=c.id) as msg_count,(SELECT content FROM messages WHERE conv_id=c.id ORDER BY created_at DESC LIMIT 1) as last_msg FROM conversations c ORDER BY c.created_at DESC`)));
app.get('/api/admin/events',       adminAuth, (req,res)=>res.json(db.all2(`SELECT e.*,u.name as creator_name,(SELECT COUNT(*) FROM rsvps WHERE event_id=e.id) as rsvp_count FROM events e LEFT JOIN users u ON e.creator_id=u.id ORDER BY e.event_date ASC`)));
app.delete('/api/admin/events/:id',adminAuth, (req,res)=>{ db.run2('DELETE FROM events WHERE id=?',[req.params.id]); saveDb(); res.json({ok:true}); });

// ─── Fallback SPA ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/index.html'));
});

// ─── WebSocket ────────────────────────────────────────────────────────────────
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://localhost').searchParams.get('token');
  let userId = null;
  try { userId = jwt.verify(token, JWT_SECRET).id; wsClients.set(userId, ws); }
  catch { ws.close(); return; }

  ws.on('message', raw => {
    try {
      const { event, data } = JSON.parse(raw);
      if (event === 'message') {
        const { conv_id, content } = data;
        if (!db.get2('SELECT conv_id FROM conv_members WHERE conv_id=? AND user_id=?', [conv_id,userId])) return;
        const id = uuid();
        db.run2(`INSERT INTO messages (id,conv_id,sender_id,type,content) VALUES (?,?,?,?,?)`, [id,conv_id,userId,'text',content]);
        saveDb();
        const sender = db.get2('SELECT name,avatar_init FROM users WHERE id=?', [userId]);
        const msg = { id,conv_id,sender_id:userId,sender_name:sender.name,sender_init:sender.avatar_init,type:'text',content,created_at:new Date().toISOString() };
        db.all2('SELECT user_id FROM conv_members WHERE conv_id=?', [conv_id]).forEach(m => {
          const mws = wsClients.get(m.user_id);
          if (mws && mws.readyState===WebSocket.OPEN) mws.send(JSON.stringify({ event:'message', data:msg }));
        });
      }
      if (event==='ping') ws.send(JSON.stringify({ event:'pong' }));
    } catch {}
  });

  ws.on('close', () => wsClients.delete(userId));
  ws.send(JSON.stringify({ event:'connected', data:{ userId } }));
});

// ─── Start ────────────────────────────────────────────────────────────────────
initSqlJs().then(SQL => {
  initDb(SQL);
  server.listen(PORT, () => {
    console.log(`\n🌿 Kalachautari running on http://localhost:${PORT}`);
    console.log(`   Demo login: aasha@demo.com / demo1234`);
    console.log(`   Admin: http://localhost:${PORT}/admin?key=${ADMIN_SECRET}\n`);
  });
}).catch(err => { console.error('DB init failed:', err); process.exit(1); });
