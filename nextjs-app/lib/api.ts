// Typed wrappers for Flask backend API calls

export interface PersonBbox {
  id: number;
  bbox: [number, number, number, number];
  thumbnail: string; // data:image/jpeg;base64,...
}

export interface UploadResult {
  url: string;
  filename: string;
}

export interface TrackRole {
  id: number;
  boxes: [number, number, number, number, number][]; // [frame, x1, y1, x2, y2]
}

export interface TrackData {
  fps: number;
  width: number;
  height: number;
  frame_count: number;
  roles: TrackRole[];
}

export interface DetectPersonsResult {
  persons: PersonBbox[];
  tracks: TrackData;
}

export interface CropPersonResult {
  task_id: string;
  cached: boolean;
  url?: string; // present when cached=true
}

export interface CropProgressEvent {
  progress: number; // 0-100
  status: string;
  output?: string; // final video URL when done
  error?: string;
}

export interface AlignResult {
  offset: number; // seconds
}

const BASE = "/api";

export async function uploadVideo(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
  return res.json();
}

/**
 * Tracks all persons in the video. The first call starts a backend tracking
 * task; waits for it via SSE, then fetches the cached result.
 */
export async function detectPersons(
  filename: string,
  onProgress?: (progress: number) => void
): Promise<DetectPersonsResult> {
  const request = async () => {
    const res = await fetch(`${BASE}/detect_persons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
    });
    if (!res.ok) throw new Error(`Detect persons failed: ${res.statusText}`);
    return res.json();
  };
  const first = await request();
  if (!first.task_id) return first;
  await watchCropProgress(first.task_id, (evt) => onProgress?.(evt.progress));
  return request();
}

export async function cropPerson(
  filename: string,
  roleId: number
): Promise<CropPersonResult> {
  const res = await fetch(`${BASE}/crop_person`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, role_id: roleId }),
  });
  if (!res.ok) throw new Error(`Crop person failed: ${res.statusText}`);
  return res.json();
}

/** Generates a black/white mask video. roleId=0 means all roles. */
export async function maskPerson(
  filename: string,
  roleId: number
): Promise<CropPersonResult> {
  const res = await fetch(`${BASE}/mask_person`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, role_id: roleId }),
  });
  if (!res.ok) throw new Error(`Mask person failed: ${res.statusText}`);
  return res.json();
}

export async function cancelTask(taskId: string): Promise<void> {
  await fetch(`${BASE}/cancel/${taskId}`, { method: "POST" });
}

/**
 * Opens an SSE connection to monitor crop progress.
 * Calls onProgress for each event, resolves with the final video URL.
 */
export function watchCropProgress(
  taskId: string,
  onProgress: (evt: CropProgressEvent) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const es = new EventSource(`${BASE}/crop_person/progress/${taskId}`);
    es.onmessage = (e) => {
      const data: CropProgressEvent = JSON.parse(e.data);
      onProgress(data);
      if (data.output) {
        es.close();
        resolve(data.output);
      } else if (data.error) {
        es.close();
        reject(new Error(data.error));
      }
    };
    es.onerror = () => {
      es.close();
      reject(new Error("SSE connection error"));
    };
  });
}

export async function smartAlign(
  coachFilename: string,
  userFilename: string
): Promise<AlignResult> {
  const res = await fetch(`${BASE}/align`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      coach_filename: coachFilename,
      user_filename: userFilename,
    }),
  });
  if (!res.ok) throw new Error(`Align failed: ${res.statusText}`);
  return res.json();
}
