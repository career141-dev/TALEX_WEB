import { supabaseAdmin } from '../config/supabase';
import prisma from '../lib/prisma';
import { config } from '../config/env';

const BUCKET = config.SUPABASE_STORAGE_BUCKET || "talex-applications";
const VIDEO_MIME = ['video/mp4'];
const DOC_MIME = [
  'application/pdf', 
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

const MAX_VIDEO = 250 * 1024 * 1024; // 250 MB
const MAX_DOC = 50 * 1024 * 1024; // 50 MB

export async function uploadFile(
  applicationId: string, 
  fileBuffer: Buffer, 
  originalName: string,
  mimeType: string, 
  sizeBytes: number, 
  fileType: 'VIDEO' | 'DOCUMENT',
  filePurpose?: string
) {
  const allowed = fileType === "VIDEO" ? VIDEO_MIME : DOC_MIME;
  if (!allowed.includes(mimeType)) throw new Error('INVALID_FILE_TYPE');
  if (sizeBytes > (fileType === 'VIDEO' ? MAX_VIDEO : MAX_DOC)) throw new Error('FILE_TOO_LARGE');

  // Cleanup old files (Replace existing)
  const existing = await prisma.applicationFile.findFirst({
    where: { 
      application_id: applicationId, 
      OR: [
        { file_type: "VIDEO", enabled: fileType === "VIDEO" }, // Use enabled as true dummy
        { file_purpose: filePurpose && filePurpose !== "" ? filePurpose : undefined }
      ].filter(cond => {
        if (fileType === 'VIDEO' && Object.keys(cond).includes('file_type')) return true;
        if (filePurpose && Object.keys(cond).includes('file_purpose')) return true;
        return false;
      }) as any
    },
  });

  // Re-write cleanup logic simply:
  const oldFile = await prisma.applicationFile.findFirst({
    where: {
      application_id: applicationId,
      ...(fileType === 'VIDEO' ? { file_type: 'VIDEO' } : { file_purpose: filePurpose })
    }
  });

  if (oldFile && (fileType === 'VIDEO' || filePurpose)) {
    console.log(`[Upload-Cleanup] Removing old ${fileType}/${filePurpose || 'VIDEO'}: ${oldFile.original_name}`);
    await supabaseAdmin.storage.from(BUCKET).remove([oldFile.storage_path]);
    await prisma.applicationFile.delete({ where: { id: oldFile.id } });
  }

  const ext = originalName.split(".").pop() ?? "bin";
  const path = `${applicationId}/${fileType.toLowerCase()}_${Date.now()}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, fileBuffer, { contentType: mimeType, upsert: false });

  if (error) throw new Error('STORAGE_UPLOAD_FAILED');

  return prisma.applicationFile.create({
    data: { 
      application_id: applicationId, 
      file_type: fileType,
      file_purpose: filePurpose,
      storage_path: path, 
      original_name: originalName,
      mime_type: mimeType, 
      size_bytes: BigInt(sizeBytes) 
    },
  });
}

// Signed URL — 1 hour access for judges/admin
export async function getSignedUrl(storagePath: string, expiresIn = 3600) {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn);

  if (error || !data) throw new Error('URL_GENERATION_FAILED');
  return data.signedUrl;
}
