import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { one, all, run, tx } from './context.js';
import { uid, nowIso } from './util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function getUploadBaseDir() {
  const dataDir = path.isAbsolute(process.env.DATA_DIR || '')
    ? process.env.DATA_DIR
    : path.resolve(root, process.env.DATA_DIR || 'data');
  const uploadsDir = path.join(dataDir, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  return uploadsDir;
}

export function sanitizeFilename(filename) {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 100);
}

export async function saveLeadAttachment(orgId, leadId, uploaderId, fileData) {
  // fileData: { filename, mimeType, buffer }
  const { filename, mimeType, buffer } = fileData;

  if (!buffer || buffer.length === 0) {
    throw new Error('Attachment file is empty.');
  }

  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error('File exceeds maximum allowed size of 10 MB.');
  }

  if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(`File type ${mimeType} is not permitted.`);
  }

  const safeName = sanitizeFilename(filename || 'attachment.dat');
  const attachmentId = uid('att');
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

  const baseDir = getUploadBaseDir();
  const orgLeadDir = path.join(baseDir, orgId, leadId);
  if (!fs.existsSync(orgLeadDir)) {
    fs.mkdirSync(orgLeadDir, { recursive: true });
  }

  const storageKey = path.join(orgId, leadId, `${attachmentId}-${safeName}`);
  const absolutePath = path.join(baseDir, storageKey);

  // Write file atomically
  const tempPath = `${absolutePath}.tmp`;
  fs.writeFileSync(tempPath, buffer);
  fs.renameSync(tempPath, absolutePath);

  const ts = nowIso();
  run(
    `INSERT INTO lead_attachments(id, organization_id, lead_id, filename, mime_type, size_bytes, checksum, storage_key, uploader_id, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      attachmentId,
      orgId,
      leadId,
      safeName,
      mimeType || 'application/octet-stream',
      buffer.length,
      checksum,
      storageKey,
      uploaderId,
      ts,
    ],
  );

  return one('SELECT * FROM lead_attachments WHERE id = ?', [attachmentId]);
}

export function listLeadAttachments(orgId, leadId) {
  return all(
    `SELECT a.*, u.name as uploader_name
     FROM lead_attachments a
     LEFT JOIN users u ON u.id = a.uploader_id
     WHERE a.organization_id = ? AND a.lead_id = ?
     ORDER BY a.created_at DESC`,
    [orgId, leadId],
  );
}

export function getLeadAttachment(orgId, leadId, attachmentId) {
  const record = one(
    `SELECT * FROM lead_attachments
     WHERE id = ? AND organization_id = ? AND lead_id = ?`,
    [attachmentId, orgId, leadId],
  );
  if (!record) return null;

  const baseDir = getUploadBaseDir();
  const filePath = path.join(baseDir, record.storage_key);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return {
    record,
    filePath,
  };
}

export function deleteLeadAttachment(orgId, leadId, attachmentId) {
  const record = one(
    `SELECT * FROM lead_attachments
     WHERE id = ? AND organization_id = ? AND lead_id = ?`,
    [attachmentId, orgId, leadId],
  );
  if (!record) return false;

  const baseDir = getUploadBaseDir();
  const filePath = path.join(baseDir, record.storage_key);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.warn('[leadpulse:storage] File deletion warning:', err.message);
  }

  run('DELETE FROM lead_attachments WHERE id = ?', [attachmentId]);
  return true;
}

