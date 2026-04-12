import Database from 'better-sqlite3';
import path from 'path';

// Database file lives in project root
const DB_PATH = path.join(process.cwd(), 'interview.db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables(db);
  }
  return db;
}

function initTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      interview_type TEXT DEFAULT 'behavioral',
      job_role TEXT DEFAULT 'Software Engineer',
      difficulty TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      ended_at TEXT
    );

    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      question_text TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'voice',
      confidence REAL DEFAULT 0.0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      answer_text TEXT NOT NULL,
      model TEXT DEFAULT 'llama3.2',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (question_id) REFERENCES questions(id),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
  `);
}

// --- Session CRUD ---

export interface Session {
  id: string;
  title: string;
  interview_type: string;
  job_role: string;
  difficulty: string;
  status: string;
  created_at: string;
  ended_at: string | null;
}

export function createSession(data: {
  title: string;
  interviewType?: string;
  jobRole?: string;
  difficulty?: string;
}): Session {
  const db = getDb();
  const id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO sessions (id, title, interview_type, job_role, difficulty)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, data.title, data.interviewType || 'behavioral', data.jobRole || 'Software Engineer', data.difficulty || 'medium');
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session;
}

export function getSession(id: string): Session | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined;
}

export function getSessions(limit = 20): Session[] {
  const db = getDb();
  return db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?').all(limit) as Session[];
}

export function endSession(id: string): void {
  const db = getDb();
  db.prepare("UPDATE sessions SET status = 'completed', ended_at = datetime('now') WHERE id = ?").run(id);
}

// --- Question CRUD ---

export interface Question {
  id: string;
  session_id: string;
  question_text: string;
  source: string;
  confidence: number;
  created_at: string;
}

export function saveQuestion(data: {
  sessionId: string;
  questionText: string;
  source: string;
  confidence: number;
}): Question {
  const db = getDb();
  const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO questions (id, session_id, question_text, source, confidence)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, data.sessionId, data.questionText, data.source, data.confidence);
  return db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as Question;
}

export function getQuestions(sessionId: string): Question[] {
  const db = getDb();
  return db.prepare('SELECT * FROM questions WHERE session_id = ? ORDER BY created_at DESC').all(sessionId) as Question[];
}

// --- Answer CRUD ---

export interface Answer {
  id: string;
  question_id: string;
  session_id: string;
  answer_text: string;
  model: string;
  created_at: string;
}

export function saveAnswer(data: {
  questionId: string;
  sessionId: string;
  answerText: string;
  model?: string;
}): Answer {
  const db = getDb();
  const id = `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO answers (id, question_id, session_id, answer_text, model)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, data.questionId, data.sessionId, data.answerText, data.model || 'llama3.2');
  return db.prepare('SELECT * FROM answers WHERE id = ?').get(id) as Answer;
}

export function getAnswers(sessionId: string): Answer[] {
  const db = getDb();
  return db.prepare('SELECT * FROM answers WHERE session_id = ? ORDER BY created_at DESC').all(sessionId) as Answer[];
}

// --- Stats ---

export function getSessionStats(sessionId: string) {
  const db = getDb();
  const questionCount = (db.prepare('SELECT COUNT(*) as count FROM questions WHERE session_id = ?').get(sessionId) as any)?.count || 0;
  const answerCount = (db.prepare('SELECT COUNT(*) as count FROM answers WHERE session_id = ?').get(sessionId) as any)?.count || 0;
  return { questionCount, answerCount };
}
