import { apiRequest, jsonBody } from '@/api/client'
import type { ProjectThumbnail } from '@/api/contracts'

export type ThumbnailUploadMode = 'auto' | 'custom'
export type ThumbnailUploadSource = 'renderer' | 'blueprint' | 'custom'
export type ThumbnailContentType = 'image/webp' | 'image/svg+xml'

export type PrepareThumbnailUploadInput = {
  draftVersion: number
  mode: ThumbnailUploadMode
  source: ThumbnailUploadSource
  contentType: ThumbnailContentType
  size: number
}

export type PreparedThumbnailUpload = {
  bucket: string
  path: string
  signedUrl: string
  token: string
  draftVersion: number
  mode: ThumbnailUploadMode
  contentType: ThumbnailContentType
  maxBytes: number
  expiresIn: number
}

type RawThumbnailProject = {
  thumbnailMode?: ProjectThumbnail['mode']
  thumbnailStatus?: ProjectThumbnail['status']
  thumbnailUrl?: string | null
  thumbnailDraftVersion?: number | null
  thumbnailErrorCode?: string | null
}

function projectThumbnail(project: RawThumbnailProject): ProjectThumbnail {
  return {
    mode: project.thumbnailMode ?? 'auto',
    status: project.thumbnailStatus ?? 'queued',
    url: project.thumbnailUrl ?? null,
    draftVersion: project.thumbnailDraftVersion ?? null,
    errorCode: project.thumbnailErrorCode ?? null,
  }
}

export async function prepareThumbnailUpload(
  projectId: string,
  input: PrepareThumbnailUploadInput,
): Promise<PreparedThumbnailUpload> {
  const response = await apiRequest<{ upload: PreparedThumbnailUpload }>(
    `/api/projects/${encodeURIComponent(projectId)}/thumbnail/upload`,
    {
      method: 'POST',
      body: jsonBody(input),
    },
  )
  return response.upload
}

export async function reconcileThumbnailArtifacts(projectId: string): Promise<void> {
  await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/thumbnail/reconcile`, {
    method: 'POST',
  })
}

/**
 * Deliberately bypasses apiRequest: this is a cross-origin Supabase Storage
 * request and must never inherit the app session, JSON content type, or CSRF
 * header. The multipart shape mirrors storage-js 2.111.0 for Blob uploads.
 */
export async function uploadThumbnailToSignedUrl(
  upload: PreparedThumbnailUpload,
  blob: Blob,
  options: {
    cacheControl?: string
    metadata?: Record<string, unknown>
  } = {},
): Promise<void> {
  const body = new FormData()
  body.append('cacheControl', options.cacheControl ?? '3600')
  if (options.metadata) body.append('metadata', JSON.stringify(options.metadata))
  body.append('', blob)

  const response = await fetch(upload.signedUrl, {
    method: 'PUT',
    credentials: 'omit',
    headers: {
      'x-upsert': 'false',
    },
    body,
  })
  if (!response.ok) {
    throw new Error(`缩略图上传失败（${response.status}）`)
  }
}

export async function completeThumbnailUpload(
  projectId: string,
  input: { draftVersion: number; path: string },
): Promise<ProjectThumbnail> {
  const response = await apiRequest<{ project: RawThumbnailProject }>(
    `/api/projects/${encodeURIComponent(projectId)}/thumbnail/complete`,
    {
      method: 'POST',
      body: jsonBody(input),
    },
  )
  return projectThumbnail(response.project)
}

export async function failThumbnailUpload(
  projectId: string,
  input: { draftVersion: number; path: string; errorCode: string },
): Promise<void> {
  await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/thumbnail/fail`, {
    method: 'POST',
    body: jsonBody(input),
  })
}

export async function publishThumbnailArtifact(
  projectId: string,
  input: PrepareThumbnailUploadInput & {
    blob: Blob
    metadata?: Record<string, unknown>
  },
): Promise<ProjectThumbnail> {
  const upload = await prepareThumbnailUpload(projectId, input)
  if (upload.draftVersion !== input.draftVersion) {
    throw new Error('缩略图签名版本与当前草稿不一致')
  }

  try {
    await uploadThumbnailToSignedUrl(upload, input.blob, {
      metadata: input.metadata,
    })
    const thumbnail = await completeThumbnailUpload(projectId, {
      draftVersion: input.draftVersion,
      path: upload.path,
    })
    if (thumbnail.draftVersion !== input.draftVersion || thumbnail.status !== 'ready') {
      throw new Error('缩略图完成响应与当前草稿不一致')
    }
    return thumbnail
  } catch (error) {
    await failThumbnailUpload(projectId, {
      draftVersion: input.draftVersion,
      path: upload.path,
      errorCode: 'thumbnail-upload-failed',
    }).catch(() => undefined)
    throw error
  }
}
