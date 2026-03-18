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

const MAX_VIDEO = 200 * 1024 * 1024; // 200 MB
const MAX_DOC = 20 * 1024 * 1024; // 20 MB

export async function uploadFile(
  applicationId: string, 
  fileBuffer: Buffer, 
  originalName: string,
  mimeType: string, 
  sizeBytes: number, 
  fileType: 'VIDEO' | 'DOCUMENT'
) {
  const allowed = fileType === "VIDEO" ? VIDEO_MIME : DOC_MIME;
  if (!allowed.includes(mimeType)) throw new Error('INVALID_FILE_TYPE');
  if (sizeBytes > (fileType === 'VIDEO' ? MAX_VIDEO : MAX_DOC)) throw new Error('FILE_TOO_LARGE');

  // Replace existing video if re-uploading
  if (fileType === "VIDEO") {
    const old = await prisma.applicationFile.findFirst({
      where: { application_id: applicationId, file_type: "VIDEO" },
    });
    if (old) {
      await supabaseAdmin.storage.from(BUCKET).remove([old.storage_path]);
      await prisma.applicationFile.delete({ where: { id: old.id } });
    }
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
