/* ================================================================
   State
   ================================================================ */
const state = {
  mode: 'side',       // 'side' | 'fusion'
  mirror: { coach: false, user: false },
  muted: { coach: false, user: true },  // coach has sound, user muted by default
  userSource: null,    // 'webcam' | 'file'
  webcamStream: null,
  webcamPortrait: false,
  trim: {
    coach: { start: 0, end: 1 },  // 0-1 ratio of duration
    user:  { start: 0, end: 1 },
  },
};

/* Video element references — always return the ACTIVE video for current mode */
function vid(role) {
  if (state.mode === 'side') {
    return role === 'coach' ? document.getElementById('coachVideo')
                            : document.getElementById('userVideo');
  }
  return role === 'coach' ? document.getElementById('fusionCoachVideo')
                          : document.getElementById('fusionUserVideo');
}

/* All video elements for a role (both modes share the same source) */
function allVids(role) {
  return role === 'coach'
    ? [document.getElementById('coachVideo'), document.getElementById('fusionCoachVideo')]
    : [document.getElementById('userVideo'), document.getElementById('fusionUserVideo')];
}

/* ================================================================
   Mode Switching
   ================================================================ */
function setMode(m) {
  state.mode = m;
  document.getElementById('sideContainer').style.display  = m === 'side' ? 'flex' : 'none';
  document.getElementById('fusionContainer').style.display = m === 'fusion' ? 'block' : 'none';
  document.getElementById('btnSide').classList.toggle('active', m === 'side');
  document.getElementById('btnFusion').classList.toggle('active', m === 'fusion');

  // Sync video sources to fusion videos when entering fusion mode
  if (m === 'fusion') {
    syncSourceToFusion('coach');
    syncSourceToFusion('user');
  }
}

function syncSourceToFusion(role) {
  const sideV = role === 'coach' ? document.getElementById('coachVideo')
                                 : document.getElementById('userVideo');
  const fusV  = role === 'coach' ? document.getElementById('fusionCoachVideo')
                                 : document.getElementById('fusionUserVideo');

  if (role === 'user' && state.userSource === 'webcam' && state.webcamStream) {
    fusV.srcObject = state.webcamStream;
    fusV.muted = state.muted[role];
    fusV.play().catch(() => {});
  } else if (sideV.src && sideV.src !== location.href) {
    fusV.src = sideV.src;
    fusV.currentTime = sideV.currentTime;
    fusV.playbackRate = sideV.playbackRate;
    fusV.muted = state.muted[role];
    if (!sideV.paused) fusV.play().catch(() => {});
  }
  // Sync mirror
  const mirrored = state.mirror[role];
  fusV.style.transform = mirrored ? 'scaleX(-1)' : '';
}

/* ================================================================
   File Upload / Source Selection
   ================================================================ */
function loadFile(input, role) {
  const file = input.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  allVids(role).forEach(v => {
    v.src = url;
    v.muted = state.muted[role];
    v.load();
  });
  // Hide placeholder
  const ph = role === 'coach' ? document.getElementById('coachPlaceholder')
                               : document.getElementById('userPlaceholder');
  ph.style.display = 'none';

  // Reset crop state and upload to server for crop support
  segState[role] = { filename: null, segUrl: null, origUrl: url, isSegmented: false };
  const btn = document.getElementById(role + 'SegBtn');
  if (btn) { btn.textContent = '✂ 裁剪'; btn.classList.remove('segmented'); }
  const saveBtn = document.getElementById(role + 'SaveBtn');
  if (saveBtn) saveBtn.style.display = 'none';
  uploadToServer(file, role);
}

function setUserSource(src) {
  state.userSource = src;
  document.getElementById('srcWebcam').classList.toggle('active', src === 'webcam');
  document.getElementById('srcFile').classList.toggle('active', src === 'file');
  document.getElementById('userFileLabel').style.display = src === 'file' ? '' : 'none';

  if (src === 'webcam') {
    startWebcam();
  } else {
    stopWebcam();
  }
}

async function startWebcam(deviceId) {
  try {
    // Stop existing stream first
    if (state.webcamStream) {
      state.webcamStream.getTracks().forEach(t => t.stop());
      state.webcamStream = null;
    }

    const w = state.webcamPortrait ? 720 : 1280;
    const h = state.webcamPortrait ? 1280 : 720;
    const constraints = {
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: w }, height: { ideal: h } }
        : { width: { ideal: w }, height: { ideal: h }, facingMode: 'user' }
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    state.webcamStream = stream;
    allVids('user').forEach(v => {
      v.srcObject = stream;
      v.play().catch(() => {});
    });
    document.getElementById('userPlaceholder').style.display = 'none';
    await populateCameraList(stream.getVideoTracks()[0].getSettings().deviceId);

    // Monitor stream end
    stream.getTracks().forEach(track => {
      track.onended = () => {
        console.log('摄像头断开');
        state.webcamStream = null;
      };
    });
  } catch (e) {
    alert('无法访问摄像头：' + e.message);
  }
}

async function populateCameraList(activeDeviceId) {
  const sel = document.getElementById('cameraSelect');
  const refreshBtn = document.getElementById('cameraRefresh');
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter(d => d.kind === 'videoinput');
  sel.innerHTML = cameras.map((d, i) =>
    `<option value="${d.deviceId}" ${d.deviceId === activeDeviceId ? 'selected' : ''}>${d.label || '摄像头 ' + (i + 1)}</option>`
  ).join('');
  sel.style.display = '';
  if (refreshBtn) refreshBtn.style.display = '';
  const orientBtn = document.getElementById('webcamOrientBtn');
  if (orientBtn) orientBtn.style.display = '';
}

async function refreshCameraList() {
  const sel = document.getElementById('cameraSelect');
  await populateCameraList(sel.value);
}

async function switchCamera(deviceId) {
  if (state.webcamStream) {
    state.webcamStream.getTracks().forEach(t => t.stop());
    state.webcamStream = null;
  }
  await startWebcam(deviceId);
}

function toggleWebcamOrientation() {
  state.webcamPortrait = !state.webcamPortrait;
  const btn = document.getElementById('webcamOrientBtn');
  if (btn) btn.textContent = state.webcamPortrait ? '竖屏' : '横屏';
  if (state.webcamStream) {
    const deviceId = state.webcamStream.getVideoTracks()[0]?.getSettings().deviceId;
    startWebcam(deviceId);
  }
}

function stopWebcam() {
  if (state.webcamStream) {
    state.webcamStream.getTracks().forEach(t => t.stop());
    state.webcamStream = null;
  }
  allVids('user').forEach(v => { v.srcObject = null; });
  document.getElementById('cameraSelect').style.display = 'none';
  const refreshBtn = document.getElementById('cameraRefresh');
  if (refreshBtn) refreshBtn.style.display = 'none';
}

/* ================================================================
   Playback Controls
   ================================================================ */
function togglePlay(role) {
  const v = vid(role);
  if (!v.src && !v.srcObject) return;
  if (v.paused) v.play().catch(() => {});
  else v.pause();
}

function setSpeed(role, val) {
  const s = parseFloat(val);
  allVids(role).forEach(v => { v.playbackRate = s; });
}

function toggleMirror(role) {
  state.mirror[role] = !state.mirror[role];
  const mirrored = state.mirror[role];
  allVids(role).forEach(v => {
    v.style.transform = mirrored ? 'scaleX(-1)' : '';
  });
  const btn = document.getElementById(role + 'MirrorBtn');
  if (btn) btn.classList.toggle('active', mirrored);
}

function toggleMute(role) {
  state.muted[role] = !state.muted[role];
  const muted = state.muted[role];
  allVids(role).forEach(v => { v.muted = muted; });
  const icon = muted ? '🔇' : '🔊';
  const btn = document.getElementById(role + 'MuteBtn');
  const fusionBtn = document.getElementById('fusion' + role.charAt(0).toUpperCase() + role.slice(1) + 'MuteBtn');
  if (btn) btn.textContent = icon;
  if (fusionBtn) fusionBtn.textContent = icon;
}

function setOpacity(role, val) {
  const el = role === 'coach' ? document.getElementById('fusionCoach')
                               : document.getElementById('fusionUser');
  el.style.opacity = val / 100;
}

function syncPlayPause() {
  const cv = vid('coach'), uv = vid('user');
  const anySrc = (cv.src && cv.src !== location.href) || cv.srcObject
              || (uv.src && uv.src !== location.href) || uv.srcObject;
  if (!anySrc) return;
  if (cv.paused || uv.paused) {
    cv.play().catch(() => {});
    uv.play().catch(() => {});
  } else {
    cv.pause();
    uv.pause();
  }
}

function syncRestart() {
  ['coach', 'user'].forEach(role => {
    const startTime = getTrimStartTime(role);
    allVids(role).forEach(v => {
      if (!v.srcObject) v.currentTime = startTime;
    });
  });
}

async function smartAlign() {
  const coachFile = segState.coach?.filename;
  const userFile = segState.user?.filename;

  if (!coachFile || !userFile) {
    alert('请先上传教练和用户视频');
    return;
  }

  const btn = document.getElementById('alignBtn');
  const origText = btn.textContent;
  btn.textContent = '分析中...';
  btn.disabled = true;

  try {
    const res = await fetch('/align', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coach_filename: coachFile, user_filename: userFile })
    });
    const data = await res.json();

    if (data.error) {
      alert('对齐失败：' + data.error);
      return;
    }

    const offset = data.offset;
    const absOffset = Math.abs(offset);
    const direction = offset > 0 ? '向后' : '向前';
    const targetRole = offset > 0 ? 'user' : 'coach';

    if (confirm(`检测到${targetRole === 'user' ? '用户' : '教练'}视频应${direction}偏移 ${absOffset.toFixed(2)} 秒，是否应用？`)) {
      applyOffset(targetRole, absOffset);
    }
  } catch (e) {
    alert('对齐失败：' + e.message);
  } finally {
    btn.textContent = origText;
    btn.disabled = false;
  }
}

function applyOffset(role, offsetSec) {
  const v = allVids(role)[0];
  if (!v || !v.duration) return;
  const newStart = Math.max(0, Math.min(1, offsetSec / v.duration));
  state.trim[role].start = newStart;

  // Update trim sliders
  const prefix = role === 'coach' ? 'Coach' : 'User';
  const startSlider = document.getElementById(role + 'TrimStart');
  const fusionStartSlider = document.getElementById('fusion' + prefix + 'TrimStart');
  if (startSlider) startSlider.value = Math.round(newStart * 1000);
  if (fusionStartSlider) fusionStartSlider.value = Math.round(newStart * 1000);

  onTrimChange(role);
  allVids(role).forEach(vid => { vid.currentTime = newStart * vid.duration; });
}

/* ================================================================
   Trim Controls
   ================================================================ */
function getTrimStartTime(role) {
  const v = allVids(role)[0];
  if (!v || !v.duration) return 0;
  return state.trim[role].start * v.duration;
}

function getTrimEndTime(role) {
  const v = allVids(role)[0];
  if (!v || !v.duration) return 0;
  return state.trim[role].end * v.duration;
}

function onTrimChange(role) {
  const prefix = role === 'coach' ? 'Coach' : 'User';
  // Read from whichever set of sliders is visible
  const ids = state.mode === 'fusion'
    ? ['fusion' + prefix + 'TrimStart', 'fusion' + prefix + 'TrimEnd']
    : [role + 'TrimStart', role + 'TrimEnd'];

  let startVal = parseInt(document.getElementById(ids[0]).value);
  let endVal   = parseInt(document.getElementById(ids[1]).value);

  // Enforce min gap
  if (startVal >= endVal) {
    if (endVal < 1000) endVal = startVal + 1;
    else startVal = endVal - 1;
    document.getElementById(ids[0]).value = startVal;
    document.getElementById(ids[1]).value = endVal;
  }

  state.trim[role].start = startVal / 1000;
  state.trim[role].end   = endVal / 1000;

  // Sync sliders between modes
  syncTrimSliders(role);
  updateTrimDisplay(role);
}

function syncTrimSliders(role) {
  const prefix = role === 'coach' ? 'Coach' : 'User';
  const s = Math.round(state.trim[role].start * 1000);
  const e = Math.round(state.trim[role].end * 1000);

  // Side sliders
  const ss = document.getElementById(role + 'TrimStart');
  const se = document.getElementById(role + 'TrimEnd');
  if (ss) ss.value = s;
  if (se) se.value = e;

  // Fusion sliders
  const fs = document.getElementById('fusion' + prefix + 'TrimStart');
  const fe = document.getElementById('fusion' + prefix + 'TrimEnd');
  if (fs) fs.value = s;
  if (fe) fe.value = e;
}

function updateTrimDisplay(role) {
  const prefix = role === 'coach' ? 'Coach' : 'User';
  const v = allVids(role)[0];
  const dur = (v && v.duration) ? v.duration : 0;
  const startT = state.trim[role].start * dur;
  const endT   = state.trim[role].end * dur;
  const trimDur = endT - startT;
  const startPct = state.trim[role].start * 100;
  const endPct   = state.trim[role].end * 100;

  // Side-by-side display
  const sv = document.getElementById(role + 'TrimStartVal');
  const ev = document.getElementById(role + 'TrimEndVal');
  const dd = document.getElementById(role + 'TrimDuration');
  const sh = document.getElementById(role + 'TrimHighlight');
  if (sv) sv.textContent = fmtTime(startT);
  if (ev) ev.textContent = fmtTime(endT);
  if (dd) dd.textContent = '= ' + trimDur.toFixed(2) + 's';
  if (sh) { sh.style.left = startPct + '%'; sh.style.width = (endPct - startPct) + '%'; }

  // Fusion display
  const fsv = document.getElementById('fusion' + prefix + 'TrimStartVal');
  const fev = document.getElementById('fusion' + prefix + 'TrimEndVal');
  const fdd = document.getElementById('fusion' + prefix + 'TrimDuration');
  const fsh = document.getElementById('fusion' + prefix + 'TrimHighlight');
  if (fsv) fsv.textContent = fmtTime(startT);
  if (fev) fev.textContent = fmtTime(endT);
  if (fdd) fdd.textContent = '= ' + trimDur.toFixed(2) + 's';
  if (fsh) { fsh.style.left = startPct + '%'; fsh.style.width = (endPct - startPct) + '%'; }
}

/* Enforce trim bounds during playback */
function enforceTrimBounds() {
  ['coach', 'user'].forEach(role => {
    allVids(role).forEach(v => {
      if (!v.duration || v.srcObject) return;
      const startT = state.trim[role].start * v.duration;
      const endT   = state.trim[role].end * v.duration;
      if (v.currentTime >= endT - 0.05) {
        v.currentTime = startT;
      }
      if (v.currentTime < startT - 0.1) {
        v.currentTime = startT;
      }
    });
  });
  requestAnimationFrame(enforceTrimBounds);
}
requestAnimationFrame(enforceTrimBounds);

/* Update trim display when video metadata loads */
['coachVideo', 'userVideo', 'fusionCoachVideo', 'fusionUserVideo'].forEach(id => {
  document.getElementById(id).addEventListener('loadedmetadata', () => {
    const role = id.includes('oach') ? 'coach' : 'user';
    updateTrimDisplay(role);
  });
});

function seekVideo(event, role) {
  const bar = event.currentTarget;
  const pct = Math.max(0, Math.min(1, event.offsetX / bar.offsetWidth));
  const v = vid(role);
  if (v.duration) v.currentTime = pct * v.duration;
}

/* ================================================================
   Progress Bar Dragging
   ================================================================ */
(function initProgressDrag() {
  const bars = [
    { barId: 'coachProgress', role: 'coach' },
    { barId: 'userProgress', role: 'user' },
    { barId: 'fusionCoachProgress', role: 'coach' },
    { barId: 'fusionUserProgress', role: 'user' },
  ];
  bars.forEach(({ barId, role }) => {
    const bar = document.getElementById(barId);
    if (!bar) return;
    let seeking = false;

    function doSeek(e) {
      const rect = bar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const v = vid(role);
      if (v && v.duration) v.currentTime = pct * v.duration;
    }

    bar.addEventListener('mousedown', e => {
      seeking = true;
      doSeek(e);
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (seeking) doSeek(e);
    });
    document.addEventListener('mouseup', () => { seeking = false; });
  });
})();

/* ================================================================
   Progress Bar & Time Display Update
   ================================================================ */
function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00.00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return m + ':' + String(sec).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
}

function updateProgress() {
  ['coach', 'user'].forEach(role => {
    const sideV = document.getElementById(role + 'Video');
    const fusV  = document.getElementById('fusion' + (role === 'coach' ? 'Coach' : 'User') + 'Video');
    const prefix = role === 'coach' ? 'Coach' : 'User';

    // Side-by-side elements
    const sideFill  = document.getElementById(role + 'Fill');
    const sideThumb = document.getElementById(role + 'Thumb');
    const sideTime  = document.getElementById(role + 'Time');
    // Fusion elements
    const fusFill   = document.getElementById('fusion' + prefix + 'Fill');
    const fusThumb  = document.getElementById('fusion' + prefix + 'Thumb');
    const fusTime   = document.getElementById('fusion' + prefix + 'Time');

    // Update side-by-side
    if (sideV && sideV.duration) {
      const pct = (sideV.currentTime / sideV.duration) * 100;
      if (sideFill)  sideFill.style.width = pct + '%';
      if (sideThumb) sideThumb.style.left = pct + '%';
      if (sideTime)  sideTime.textContent = fmtTime(sideV.currentTime) + ' / ' + fmtTime(sideV.duration);
    } else if (sideV && sideV.srcObject) {
      // Webcam in side mode
      if (sideTime) sideTime.textContent = '实时';
    }
    // Update fusion
    if (fusV && fusV.duration) {
      const pct = (fusV.currentTime / fusV.duration) * 100;
      if (fusFill)  fusFill.style.width = pct + '%';
      if (fusThumb) fusThumb.style.left = pct + '%';
      if (fusTime)  fusTime.textContent = fmtTime(fusV.currentTime) + ' / ' + fmtTime(fusV.duration);
    } else if (fusV && fusV.srcObject) {
      // Webcam in fusion mode
      if (fusTime) fusTime.textContent = '实时';
      if (fusFill) fusFill.style.width = '0%';
      if (fusThumb) fusThumb.style.left = '0%';
    }
  });
  requestAnimationFrame(updateProgress);
}
requestAnimationFrame(updateProgress);

/* ================================================================
   Keyboard Shortcuts
   ================================================================ */
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    syncPlayPause();
  }
});

/* ================================================================
   Fusion Mode: Drag & Zoom
   ================================================================ */
(function initFusionDrag() {
  const els = ['fusionCoach', 'fusionUser'];
  els.forEach(id => {
    const el = document.getElementById(id);
    const handle = el.querySelector('.resize-handle');
    let dragging = false, resizing = false, startX, startY, origLeft, origTop, origW;

    // Resize via corner handle
    handle.addEventListener('mousedown', e => {
      e.stopPropagation();
      resizing = true;
      startX = e.clientX;
      origW = el.offsetWidth;
      e.preventDefault();
    });

    // Move via body
    el.addEventListener('mousedown', e => {
      if (resizing) return;
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      origLeft = el.offsetLeft; origTop = el.offsetTop;
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (resizing) {
        const w = Math.max(160, Math.min(window.innerWidth, origW + e.clientX - startX));
        el.style.width = w + 'px';
      } else if (dragging) {
        el.style.left = (origLeft + e.clientX - startX) + 'px';
        el.style.top  = (origTop  + e.clientY - startY) + 'px';
      }
    });

    document.addEventListener('mouseup', () => { dragging = false; resizing = false; });

    // Scroll to resize (keep existing)
    el.addEventListener('wheel', e => {
      e.preventDefault();
      let w = el.offsetWidth;
      const delta = e.deltaY > 0 ? -40 : 40;
      w = Math.max(160, Math.min(window.innerWidth, w + delta));
      el.style.width = w + 'px';
    }, { passive: false });
  });
})();
/* ================================================================
   Cropping
   ================================================================ */
const segState = {
  coach: { filename: null, segUrl: null, origUrl: null, isSegmented: false },
  user:  { filename: null, segUrl: null, origUrl: null, isSegmented: false },
};
let _segRole = null;
let _segEventSource = null;
let _segStartTime = null;

/* Upload file to server and track filename */
async function uploadToServer(file, role) {
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch('/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.filename) {
      segState[role].filename = data.filename;
      segState[role].origUrl = null;  // will be set from blob url
      checkAlignButton();
    }
  } catch (e) {
    console.warn('Upload failed:', e);
  }
}

function checkAlignButton() {
  const btn = document.getElementById('alignBtn');
  if (btn && segState.coach?.filename && segState.user?.filename) {
    btn.style.display = '';
  }
}

/* Detect persons and show selection popup */
async function openSegPopup(role, btn) {
  const st = segState[role];
  if (!st.filename) {
    alert('请先上传视频文件');
    return;
  }
  _segRole = role;

  // If already cropped, toggle back to original
  if (st.isSegmented) {
    revertSegment(role);
    return;
  }

  // Detect persons
  try {
    const res = await fetch('/detect_persons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: st.filename }),
    });
    const data = await res.json();

    if (data.error) {
      alert('检测失败：' + data.error);
      return;
    }

    const persons = data.persons;
    if (persons.length === 1) {
      // Single person - start cropping directly
      startCrop(role, persons[0].bbox);
    } else {
      // Multiple persons - show selection popup
      showPersonSelection(persons);
    }
  } catch (e) {
    alert('检测失败：' + e.message);
  }
}

function showPersonSelection(persons) {
  const popup = document.getElementById('personPopup');
  const grid = document.getElementById('personGrid');
  grid.innerHTML = '';

  persons.forEach(p => {
    const item = document.createElement('div');
    item.className = 'person-item';
    item.innerHTML = `
      <img src="${p.thumbnail}" alt="Person ${p.id + 1}">
      <div class="label">人物 ${p.id + 1}</div>
    `;
    item.onclick = () => {
      popup.classList.remove('active');
      startCrop(_segRole, p.bbox);
    };
    grid.appendChild(item);
  });

  popup.classList.add('active');
}

function closePersonPopup() {
  document.getElementById('personPopup').classList.remove('active');
}

async function startCrop(role, bbox) {
  const st = segState[role];
  if (!st.filename) return;

  let data;
  try {
    const res = await fetch('/crop_person', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: st.filename, bbox }),
    });
    data = await res.json();
  } catch (e) {
    alert('裁剪失败：' + e.message);
    return;
  }

  if (data.error) { alert('裁剪失败：' + data.error); return; }

  if (data.cached) {
    applyCroppedVideo(role, data.url);
    return;
  }

  showSegOverlay();
  document.getElementById('segSubtitle').textContent = '正在追踪并裁剪人物...';
  _segStartTime = Date.now();

  if (_segEventSource) _segEventSource.close();
  _segEventSource = new EventSource('/crop_person/progress/' + data.task_id);

  _segEventSource.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    updateSegProgress(msg.progress || 0);

    if (msg.status === 'done') {
      _segEventSource.close();
      _segEventSource = null;
      hideSegOverlay();
      applyCroppedVideo(role, msg.output);
    } else if (msg.status === 'error') {
      _segEventSource.close();
      _segEventSource = null;
      hideSegOverlay();
      alert('裁剪出错：' + (msg.error || '未知错误'));
    }
  };

  _segEventSource.onerror = () => {
    _segEventSource.close();
    _segEventSource = null;
    hideSegOverlay();
    alert('连接中断，请重试');
  };
}

function applyCroppedVideo(role, url) {
  const st = segState[role];
  const sideV = document.getElementById(role + 'Video');
  if (!st.origUrl) st.origUrl = sideV.src;
  st.segUrl = url;
  st.isSegmented = true;

  allVids(role).forEach(v => {
    const wasPlaying = !v.paused;
    const t = v.currentTime;
    v.src = url;
    v.load();
    v.addEventListener('loadedmetadata', () => {
      v.currentTime = Math.min(t, Math.max(0, (v.duration || t) - 0.05));
      if (wasPlaying) v.play().catch(() => {});
    }, { once: true });
  });

  const btn = document.getElementById(role + 'SegBtn');
  if (btn) {
    btn.textContent = '✓ 已裁剪';
    btn.classList.add('segmented');
    btn.title = '点击恢复原始视频';
  }

  const saveBtn = document.getElementById(role + 'SaveBtn');
  if (saveBtn) saveBtn.style.display = '';
}

function revertSegment(role) {
  const st = segState[role];
  if (!st.origUrl) return;
  st.isSegmented = false;

  allVids(role).forEach(v => {
    const wasPlaying = !v.paused;
    const t = v.currentTime;
    v.src = st.origUrl;
    v.load();
    v.addEventListener('loadedmetadata', () => {
      v.currentTime = Math.min(t, Math.max(0, (v.duration || t) - 0.05));
      if (wasPlaying) v.play().catch(() => {});
    }, { once: true });
  });

  const btn = document.getElementById(role + 'SegBtn');
  if (btn) {
    btn.textContent = '✂ 裁剪';
    btn.classList.remove('segmented');
    btn.title = '';
  }

  const saveBtn = document.getElementById(role + 'SaveBtn');
  if (saveBtn) saveBtn.style.display = 'none';
}

function downloadCroppedVideo(role) {
  const st = segState[role];
  if (!st.segUrl) return;

  const link = document.createElement('a');
  link.href = st.segUrl;
  const base = st.filename ? st.filename.replace(/\.[^.]+$/, '') : role;
  link.download = `${base}_crop.mp4`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function showSegOverlay() {
  document.getElementById('segOverlay').classList.add('active');
  updateSegProgress(0);
}

function hideSegOverlay() {
  document.getElementById('segOverlay').classList.remove('active');
}

function closeSegOverlay() {
  hideSegOverlay();
  // SSE continues in background; overlay just hidden
}

function updateSegProgress(pct) {
  document.getElementById('segProgressFill').style.width = pct + '%';
  document.getElementById('segPct').textContent = pct + '%';

  if (_segStartTime && pct > 0) {
    const elapsed = (Date.now() - _segStartTime) / 1000;
    const total = elapsed / (pct / 100);
    const remaining = Math.max(0, total - elapsed);
    const mins = Math.floor(remaining / 60);
    const secs = Math.round(remaining % 60);
    const etaStr = mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`;
    document.getElementById('segEta').textContent = `预计剩余时间：${etaStr}`;
  }
}

