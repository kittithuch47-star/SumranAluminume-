
import admin from 'firebase-admin';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const BASE = 'artifacts/sumran-aluminum-billing/companies/sumran-aluminum-shop';
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PHOTO_CATEGORIES = new Set(['before', 'during', 'after']);

function reply(res, status, body) {
  return res.status(status).json(body);
}

function getFirebase() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured');
    }

    let serviceAccount;
    try {
      serviceAccount = JSON.parse(raw);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
    }

    if (
      !serviceAccount.project_id ||
      !serviceAccount.client_email ||
      !serviceAccount.private_key
    ) {
      throw new Error('Firebase service account is incomplete');
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }

  return {
    auth: admin.auth(),
    firestore: admin.firestore()
  };
}

function validImage(bytes, contentType) {
  if (contentType === 'image/png') {
    return bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(
        Buffer.from('89504e470d0a1a0a', 'hex')
      );
  }

  if (contentType === 'image/jpeg') {
    return bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff;
  }

  if (contentType === 'image/webp') {
    return bytes.length >= 12 &&
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP';
  }

  return false;
}

async function callAppsScript(payload) {
  const url = process.env.GOOGLE_APPS_SCRIPT_URL;
  const secret = process.env.DRIVE_BRIDGE_SECRET;

  if (!url || !secret) {
    throw new Error('Drive bridge configuration is incomplete');
  }

  const parsed = new URL(url);

  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'script.google.com' ||
    !parsed.pathname.endsWith('/exec')
  ) {
    throw new Error('Invalid Google Apps Script URL');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify({ ...payload, secret }),
    redirect: 'follow',
    signal: AbortSignal.timeout(25000)
  });

  const raw = await response.text();
  let result;

  try {
    result = JSON.parse(raw);
  } catch {
    throw new Error('Apps Script returned invalid response');
  }

  if (!response.ok || result?.ok !== true) {
    console.error(
      'Drive bridge error:',
      String(result?.error || response.status).slice(0, 250)
    );
    throw new Error('Apps Script rejected the Drive request');
  }

  return result;
}

function linkedToJob(plan, fileId) {
  const evidence = plan.get('evidence') || {};
  const photos = Array.isArray(evidence.photos)
    ? evidence.photos
    : [];
  const signatures = evidence.signature
    ? [evidence.signature]
    : [];

  return [...photos, ...signatures].some(
    item =>
      item &&
      item.provider === 'drive' &&
      item.fileId === fileId
  );
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return reply(res, 405, {
      ok: false,
      error: 'POST only'
    });
  }

  try {
    const token = /^Bearer\s+(.+)$/i.exec(
      req.headers.authorization || ''
    )?.[1];

    if (!token) {
      return reply(res, 401, {
        ok: false,
        error: 'Missing Firebase ID token'
      });
    }

    const { auth, firestore } = getFirebase();

    let user;

    try {
      user = await auth.verifyIdToken(token, true);
    } catch {
      return reply(res, 401, {
        ok: false,
        error: 'Invalid or expired Firebase ID token'
      });
    }

    if (
      user.email_verified !== true ||
      user.firebase?.sign_in_provider !== 'google.com'
    ) {
      return reply(res, 403, {
        ok: false,
        error: 'Verified Google Sign-In required'
      });
    }

    const member = await firestore.doc(
      `${BASE}/members/${user.uid}`
    ).get();

    if (
      !member.exists ||
      member.get('active') !== true ||
      !['owner', 'staff'].includes(member.get('role'))
    ) {
      return reply(res, 403, {
        ok: false,
        error: 'Not an active shop member'
      });
    }

    const {
      action,
      jobId,
      kind,
      photoCategory,
      fileId,
      contentType,
      data,
      name
    } = req.body || {};

    if (
      typeof jobId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,140}$/.test(jobId)
    ) {
      return reply(res, 400, {
        ok: false,
        error: 'Invalid jobId'
      });
    }

    if (!['upload', 'read', 'delete'].includes(action)) {
      return reply(res, 400, {
        ok: false,
        error: 'Unknown action'
      });
    }

    const plan = await firestore.doc(
      `${BASE}/warehouseJobPlans/${jobId}`
    ).get();

    if (!plan.exists) {
      return reply(res, 404, {
        ok: false,
        error: 'Job not found'
      });
    }

    if (action === 'upload') {
      if (!['photo', 'signature'].includes(kind)) {
        return reply(res, 400, {
          ok: false,
          error: 'Invalid kind'
        });
      }

      // V11.19: Validate the photo category.
      // A category is mandatory for new photo uploads.
      if (
        kind === 'photo' &&
        !PHOTO_CATEGORIES.has(photoCategory)
      ) {
        return reply(res, 400, {
          ok: false,
          error: 'Invalid or missing photoCategory'
        });
      }

      if (
        !IMAGE_TYPES.has(contentType) ||
        (kind === 'signature' && contentType !== 'image/png')
      ) {
        return reply(res, 400, {
          ok: false,
          error: 'Unsupported image type'
        });
      }

      if (
        typeof data !== 'string' ||
        data.length < 20 ||
        data.length > MAX_BASE64_LENGTH ||
        data.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
      ) {
        return reply(res, 413, {
          ok: false,
          error: 'Invalid or oversized Base64 image'
        });
      }

      const bytes = Buffer.from(data, 'base64');

      if (
        bytes.length > MAX_IMAGE_BYTES ||
        !validImage(bytes, contentType)
      ) {
        return reply(res, 400, {
          ok: false,
          error: 'Image is oversized or has an invalid type'
        });
      }

      const result = await callAppsScript({
        action: 'upload',
        jobId,
        kind,
        ...(kind === 'photo' ? { photoCategory } : {}),
        contentType,
        data,
        name: String(name || '').slice(0, 120)
      });

      if (
        typeof result.fileId !== 'string' ||
        !/^[A-Za-z0-9_-]{10,160}$/.test(result.fileId)
      ) {
        throw new Error('Apps Script returned an invalid file ID');
      }

      return reply(res, 200, {
        ok: true,
        fileId: result.fileId
      });
    }

    if (action === 'delete') {
      return reply(res, 409, {
        ok: false,
        error: 'Deletion is disabled to preserve audit evidence'
      });
    }

    if (
      typeof fileId !== 'string' ||
      !/^[A-Za-z0-9_-]{10,160}$/.test(fileId)
    ) {
      return reply(res, 400, {
        ok: false,
        error: 'Invalid file ID'
      });
    }

    if (!linkedToJob(plan, fileId)) {
      return reply(res, 403, {
        ok: false,
        error: 'File is not linked to this job'
      });
    }

    const result = await callAppsScript({
      action: 'read',
      jobId,
      fileId
    });

    if (
      !IMAGE_TYPES.has(result.contentType) ||
      typeof result.data !== 'string'
    ) {
      throw new Error('Apps Script returned invalid image data');
    }

    return reply(res, 200, {
      ok: true,
      contentType: result.contentType,
      data: result.data
    });

  } catch (error) {
    console.error('Drive API error:', error?.message || error);

    return reply(res, 500, {
      ok: false,
      error: 'Drive request failed; check Vercel logs'
    });
  }
}
