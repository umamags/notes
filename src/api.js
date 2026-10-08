// Thin fetch wrapper around the PHP API. URLs are relative so the app works from any sub-path.
export class ApiError extends Error {
  constructor(status, message, data) {
    super(message)
    this.status = status
    this.data = data
  }
}

async function req(method, path, body, opts = {}) {
  const headers = { 'X-Requested-With': 'folio' }
  let payload
  if (body instanceof FormData) {
    payload = body
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res
  try {
    res = await fetch(`api/${path}`, { method, headers, body: payload, keepalive: opts.keepalive, signal: opts.signal })
  } catch (e) {
    throw new ApiError(0, 'Cannot reach the server', null)
  }
  let data = null
  const text = await res.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { error: text.slice(0, 200) }
    }
  }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`, data)
  return data
}

export const api = {
  bootstrap: () => req('GET', 'bootstrap'),
  getNote: (id) => req('GET', `notes/${id}`),
  createNote: (data) => req('POST', 'notes', data),
  bulkCreate: (notes) => req('POST', 'notes/bulk', { notes }),
  updateNote: (id, data, opts) => req('PUT', `notes/${id}`, data, opts),
  deleteNote: (id, permanent) => req('DELETE', `notes/${id}${permanent ? '?permanent=1' : ''}`),
  restoreNote: (id) => req('POST', `notes/${id}/restore`, {}),
  duplicateNote: (id) => req('POST', `notes/${id}/duplicate`, {}),
  links: (id, mentions) => req('GET', `notes/${id}/links${mentions ? '?mentions=1' : ''}`),
  versions: (id) => req('GET', `notes/${id}/versions`),
  getVersion: (id, vid) => req('GET', `notes/${id}/versions/${vid}`),
  saveVersion: (id, label) => req('POST', `notes/${id}/versions`, { label }),
  restoreVersion: (id, vid) => req('POST', `notes/${id}/versions/${vid}/restore`, {}),
  deleteVersion: (id, vid) => req('DELETE', `notes/${id}/versions/${vid}`),
  search: (q, limit = 60, signal) => req('GET', `search?q=${encodeURIComponent(q)}&limit=${limit}`, undefined, { signal }),
  createNotebook: (data) => req('POST', 'notebooks', data),
  updateNotebook: (id, data) => req('PUT', `notebooks/${id}`, data),
  deleteNotebook: (id) => req('DELETE', `notebooks/${id}`),
  renameTag: (from, to) => req('POST', 'tags/rename', { from, to }),
  deleteTag: (from) => req('POST', 'tags/delete', { from }),
  emptyTrash: () => req('POST', 'trash/empty', {}),
  saveSettings: (s) => req('PUT', 'settings', s),
  unfurl: (url) => req('GET', `unfurl?url=${encodeURIComponent(url)}`),
  upload: (file, name) => {
    const fd = new FormData()
    fd.append('file', file, name || file.name || 'file')
    return req('POST', 'upload', fd)
  },
  fileText: (id) => req('GET', `files/${id}/text`),
  saveFileText: (id, text) => req('PUT', `files/${id}/text`, { text }),
  stats: () => req('GET', 'stats'),
  reindex: () => req('POST', 'maintenance/reindex', {}),
  removeSamples: () => req('POST', 'maintenance/remove-samples', {}),
}

export const fileUrl = (id, download) => `api/files/${id}${download ? '?download=1' : ''}`
