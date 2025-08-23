import fs from 'fs';
import path from 'path';
import os from 'os';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function getConfigPath() {
  const dir = path.join(os.homedir(), '.qlood');
  ensureDir(dir);
  return path.join(dir, 'config.json');
}

export function loadConfig() {
  const p = getConfigPath();
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

export function saveConfig(cfg) {
  const p = getConfigPath();
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  try { fs.chmodSync(p, 0o600); } catch {}
}

export function setApiKey(key) {
  const cfg = loadConfig();
  // Sanitize API key to prevent Unicode corruption
  cfg.apiKey = key.replace(/[\uFFFD]/g, '').trim();
  saveConfig(cfg);
}

export function getModel() {
  return 'google/gemini-2.0-flash-001';
}

export function getApiKey() {
  const cfg = loadConfig();
  return process.env.OPENROUTER_API_KEY || cfg.apiKey;
}

export function setMainPrompt(prompt) {
  const cfg = loadConfig();
  cfg.mainPrompt = prompt;
  saveConfig(cfg);
}

export function getMainPrompt() {
  const cfg = loadConfig();
  return cfg.mainPrompt || 'You are a helpful AI assistant that can control web browsers and execute CLI commands to help users accomplish their goals.';
}

export function setSystemInstructions(instructions) {
  const cfg = loadConfig();
  cfg.systemInstructions = instructions;
  saveConfig(cfg);
}

export function getSystemInstructions() {
  const cfg = loadConfig();
  return cfg.systemInstructions || '';
}
