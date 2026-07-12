/**
 * cloudinary.js
 * Upload / delete invoice PDFs on Cloudinary.
 *
 * Supports two modes:
 *   1. Per-company credentials  (pass `companyCreds` object)
 *   2. Global env-var fallback  (CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET)
 */
import { v2 as cloudinary } from 'cloudinary';

/**
 * Returns a configured Cloudinary instance.
 * @param {{ cloudName, apiKey, apiSecret }|null} creds
 */
function getClient(creds) {
  const cfg = {
    cloud_name: creds?.cloudName || process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    creds?.apiKey    || process.env.CLOUDINARY_API_KEY,
    api_secret: creds?.apiSecret || process.env.CLOUDINARY_API_SECRET,
  };
  // Clone the singleton with the right config for this call.
  cloudinary.config(cfg);
  return cloudinary;
}

/**
 * Upload a PDF Buffer to Cloudinary.
 * @param {Buffer} buffer
 * @param {string} publicId     – e.g. "invoices/INV-197"
 * @param {{ cloudName, apiKey, apiSecret }|null} creds – company-level creds (optional)
 */
export async function uploadPdfToCloudinary(buffer, publicId, creds = null) {
  const client = getClient(creds);
  return new Promise((resolve, reject) => {
    const stream = client.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: 'raw',
        folder: 'invoices',
        overwrite: true,
        use_filename: false,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
}

/**
 * Upload an image (base64 data URL) to Cloudinary. Used for company logos.
 * Returns { url, publicId }.
 * @param {string} dataUri  – "data:image/png;base64,..."
 * @param {string} publicId – e.g. "logos/<companyId>"
 * @param {{ cloudName, apiKey, apiSecret }|null} creds
 */
export async function uploadImageToCloudinary(dataUri, publicId, creds = null) {
  const client = getClient(creds);
  return client.uploader.upload(dataUri, {
    public_id: publicId,
    resource_type: 'image',
    folder: 'logos',
    overwrite: true,
    use_filename: false,
    transformation: [{ width: 256, height: 256, crop: 'limit' }],
  }).then((result) => ({ url: result.secure_url, publicId: result.public_id }));
}

export async function deleteImageFromCloudinary(publicId, creds = null) {
  if (!publicId) return;
  const client = getClient(creds);
  try {
    await client.uploader.destroy(publicId, { resource_type: 'image' });
  } catch (e) {
    console.error('[cloudinary] image delete failed:', e.message);
  }
}

/**
 * Delete a previously uploaded PDF from Cloudinary.
 * @param {string} publicId
 * @param {{ cloudName, apiKey, apiSecret }|null} creds
 */
export async function deletePdfFromCloudinary(publicId, creds = null) {
  if (!publicId) return;
  const client = getClient(creds);
  try {
    await client.uploader.destroy(publicId, { resource_type: 'raw' });
  } catch (e) {
    console.warn('[cloudinary] delete failed:', e.message);
  }
}
