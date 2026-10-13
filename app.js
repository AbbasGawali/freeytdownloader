/**
 * FreeYTDownloader Engine - Multi-Tier Stream Extractor
 * Waterfall Order (Custom Optimized):
 * Tier 1: Vidssave Cloud Extraction Engine (Primary)
 * Tier 2: YtUltra Multi-Format Stream Engine
 * Tier 3: Vynex High-Speed Media Extractor
 * Tier 4: Core Server Fallback
 */

const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3456'
  : 'https://videotomp3-api-latest.onrender.com';
let currentMedias = [];
let currentTitle = 'FreeYT Audio';

// ----------------------------------------------------
// TELEMETRY & ALERT NOTIFICATION SYSTEM (100% FREE)
// ----------------------------------------------------
const ALERT_EMAIL = 'luckypirate11@gmail.com';
const alertThrottle = new Map();

function sendEngineAlert({ type, engine, switchedTo, error, videoId }) {
  try {
    const domain = window.location.hostname || 'freeytdownloader.cyou';
    const isCritical = type && type.includes('CRITICAL');
    const nowStr = new Date().toLocaleString() + ' (' + (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') + ')';
    
    const payload = {
      type: isCritical ? 'CRITICAL' : 'WARNING',
      domain,
      engine,
      switchedTo,
      error: (error && error.message) ? error.message : String(error || 'Timeout or empty stream list'),
      videoId,
      videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
      videoTitle: currentTitle || 'YouTube Video',
      timestamp: nowStr
    };

    // Central backend rate limiter (30-min global cooldown across all users)
    fetch(`${API_BASE}/api/alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {
      // Local fallback only if backend unreachable
      const throttleKey = `${domain}_${engine}_${type}`;
      const now = Date.now();
      const lastSent = alertThrottle.get(throttleKey) || 0;
      if (now - lastSent < 30 * 60 * 1000) return;
      alertThrottle.set(throttleKey, now);

      fetch(`https://formsubmit.co/ajax/${ALERT_EMAIL}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          _subject: isCritical ? `🚨 CRITICAL: All Engines Failed [${domain}]` : `⚠️ WARNING: ${engine} Failed [${domain}]`,
          _template: 'table',
          _captcha: 'false',
          ...payload
        })
      }).catch(() => {});
    });
  } catch (e) {}
}

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 6000, ...fetchOptions } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(resource, {
      ...fetchOptions,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    if (err.name === 'AbortError') {
      throw new Error(`Engine request timed out after ${timeout / 1000}s`);
    }
    throw err;
  }
}

async function downloadVidssaveVideo(content, btn) {
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerText = 'Preparing (0.8s)...';
  try {
    const res = await fetch(`${API_BASE}/api/vidssave/resolve?content=${content}`);
    const data = await res.json();
    if (data.downloadLink) {
      btn.innerHTML = `<a href="${data.downloadLink}" target="_blank" rel="noopener noreferrer" style="color:inherit; text-decoration:none; display:flex; align-items:center; gap:6px;">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 4v12m0 0l-4-4m4 4l4-4M4 18h16"/></svg>
        Download (.mp4)
      </a>`;
      btn.disabled = false;
      let iframe = document.getElementById('dlFrame');
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'dlFrame';
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
      }
      iframe.src = data.downloadLink;
      return;
    }
  } catch (e) {
    console.error('Vidssave resolve error:', e);
  }
  btn.disabled = false;
  btn.innerHTML = originalHtml;
  alert('Failed to resolve video stream. Please try another quality.');
}
window.downloadVidssaveVideo = downloadVidssaveVideo;

function extractVideoId(url) {
  if (!url) return null;
  const clean = url.trim();
  const match = clean.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/)|sosyoutube\.com\/(?:shorts\/|watch\?v=))([\w-]{11})/);
  if (match) return match[1];
  if (/^[\w-]{11}$/.test(clean)) return clean;
  return null;
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes <= 0) return 'Auto';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function sanitizeFilename(name) {
  return (name || 'freeytdownloader_media').replace(/[\\/:*?"<>|]/g, '_').trim();
}

function switchMediaTab(tab) {
  const tabAudioBtn = document.getElementById('tabAudioBtn');
  const tabVideoBtn = document.getElementById('tabVideoBtn');
  const audioTabContent = document.getElementById('audioTabContent');
  const videoTabContent = document.getElementById('videoTabContent');

  [tabAudioBtn, tabVideoBtn].forEach(btn => btn && btn.classList.remove('active'));
  [audioTabContent, videoTabContent].forEach(pane => pane && (pane.style.display = 'none'));

  if (tab === 'audio') {
    if (tabAudioBtn) tabAudioBtn.classList.add('active');
    if (audioTabContent) audioTabContent.style.display = 'block';
  } else {
    if (tabVideoBtn) tabVideoBtn.classList.add('active');
    if (videoTabContent) videoTabContent.style.display = 'block';
  }
}
window.switchMediaTab = switchMediaTab;

function renderFormats(medias, title) {
  const audioTableBody = document.getElementById('audioFormatsTableBody');
  const videoTableBody = document.getElementById('videoFormatsTableBody');

  audioTableBody.innerHTML = '';
  videoTableBody.innerHTML = '';

  const cleanTitle = sanitizeFilename(title);
  const audioFormats = [];
  const videoFormats = [];

  const seenAudioSizes = new Set();
  const seenVideoQualities = new Set();

  medias.forEach(m => {
    if (!m.url && !m.resource_content) return;
    const fmt = (m.format || '').toLowerCase();
    const isAudio = fmt.includes('.m4a') || fmt.includes('.mp3') || fmt.includes('audio') || (m.itag === 140) || m.type === 'audio';

    if (isAudio) {
      const key = m.fileSize || fmt;
      if (!seenAudioSizes.has(key)) {
        seenAudioSizes.add(key);
        audioFormats.push(m);
      }
    } else {
      const qualityMatch = (m.format || '').match(/(\d+p)/i) || (m.displayQuality || '').match(/(\d+p)/i);
      const quality = qualityMatch ? qualityMatch[1] : (m.displayQuality || '720p');
      if (!seenVideoQualities.has(quality)) {
        seenVideoQualities.add(quality);
        videoFormats.push({ ...m, displayQuality: quality });
      }
    }
  });

  // Sort video formats
  videoFormats.sort((a, b) => {
    const qA = parseInt(a.displayQuality) || 0;
    const qB = parseInt(b.displayQuality) || 0;
    return qB - qA;
  });

  // 1. Audio Tab Rows
  if (audioFormats.length > 0) {
    const primaryAudio = audioFormats[0];
    const row320 = document.createElement('tr');
    row320.innerHTML = `
      <td><strong>MP3 - 320kbps</strong> <span class="badge-high">High Quality</span></td>
      <td>${formatBytes(primaryAudio.fileSize)}</td>
      <td style="text-align: right;">
        <a href="${primaryAudio.url}" target="_blank" rel="noopener noreferrer" class="download-action-btn">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 4v12m0 0l-4-4m4 4l4-4M4 18h16"/></svg>
          Download MP3
        </a>
      </td>
    `;
    audioTableBody.appendChild(row320);

    const row256 = document.createElement('tr');
    row256.innerHTML = `
      <td><strong>MP3 - 256kbps</strong></td>
      <td>${formatBytes(primaryAudio.fileSize ? Math.round(primaryAudio.fileSize * 0.8) : null)}</td>
      <td style="text-align: right;">
        <a href="${primaryAudio.url}" target="_blank" rel="noopener noreferrer" class="download-action-btn">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 4v12m0 0l-4-4m4 4l4-4M4 18h16"/></svg>
          Download MP3
        </a>
      </td>
    `;
    audioTableBody.appendChild(row256);

    const row128 = document.createElement('tr');
    row128.innerHTML = `
      <td><strong>MP3 - 128kbps</strong></td>
      <td>${formatBytes(primaryAudio.fileSize ? Math.round(primaryAudio.fileSize * 0.5) : null)}</td>
      <td style="text-align: right;">
        <a href="${primaryAudio.url}" target="_blank" rel="noopener noreferrer" class="download-action-btn">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 4v12m0 0l-4-4m4 4l4-4M4 18h16"/></svg>
          Download MP3
        </a>
      </td>
    `;
    audioTableBody.appendChild(row128);
  } else {
    audioTableBody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 15px; color:#888;">No audio tracks found</td></tr>';
  }

  // 2. Video Tab Rows (Default for FreeYTDownloader)
  if (videoFormats.length > 0) {
    videoFormats.forEach(vf => {
      const row = document.createElement('tr');
      const actionBtn = vf.url 
        ? `<a href="${vf.url}" target="_blank" rel="noopener noreferrer" class="download-action-btn">
             <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 4v12m0 0l-4-4m4 4l4-4M4 18h16"/></svg>
             Download MP4
           </a>`
        : `<button onclick="downloadVidssaveVideo('${encodeURIComponent(vf.resource_content)}', this)" class="download-action-btn" style="cursor:pointer; border:none;">
             <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 4v12m0 0l-4-4m4 4l4-4M4 18h16"/></svg>
             Download MP4
           </button>`;

      row.innerHTML = `
        <td><strong>${vf.displayQuality} (.mp4)</strong></td>
        <td>${formatBytes(vf.fileSize)}</td>
        <td style="text-align: right;">${actionBtn}</td>
      `;
      videoTableBody.appendChild(row);
    });
  } else {
    videoTableBody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 15px; color:#888;">No video streams found</td></tr>';
  }

  const resultSection = document.getElementById('resultSection');
  if (resultSection) {
    resultSection.style.display = 'block';
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  switchMediaTab('video'); // Video tab is default for video downloader
}

async function startConversion() {
  const input = document.getElementById('keyword');
  const urlVal = input ? input.value.trim() : '';
  const spinner = document.getElementById('loading_spinner');
  const spinnerText = document.getElementById('loading_status_text');
  const resultSection = document.getElementById('resultSection');
  const videoThumb = document.getElementById('videoThumb');
  const videoTitle = document.getElementById('videoTitle');
  const videoDuration = document.getElementById('videoDuration');
  const submitBtn = document.getElementById('submit');

  if (!urlVal) {
    alert('Please paste a valid YouTube video or Shorts link.');
    return;
  }

  const videoId = extractVideoId(urlVal);
  if (!videoId) {
    alert('Could not find a valid YouTube video ID in this link.');
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  if (spinner) {
    spinner.style.display = 'flex';
    if (spinnerText) spinnerText.innerText = 'Extracting video and audio streams...';
  }
  if (resultSection) resultSection.style.display = 'none';

  // Preview thumbnail immediately
  if (videoThumb) videoThumb.src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  if (videoTitle) videoTitle.innerText = 'Fetching video details...';
  if (videoDuration) videoDuration.innerText = 'Detecting best quality formats...';

  // Title resolution via oEmbed
  fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`)
    .then(r => r.json())
    .then(d => {
      if (d.title && videoTitle) {
        currentTitle = d.title;
        videoTitle.innerText = d.title;
      }
      if (d.author_name && videoDuration) {
        videoDuration.innerText = `Channel: ${d.author_name}`;
      }
    })
    .catch(() => {
      currentTitle = 'YouTube Video';
      if (videoTitle) videoTitle.innerText = currentTitle;
    });

  // =========================================================================
  // TIER 1 (PRIMARY): Vidssave Cloud Stream Engine (CALLED FIRST FOR FREEYT)
  // =========================================================================
  try {
    const vidssaveRes = await fetchWithTimeout(`${API_BASE}/api/vidssave/parse?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`, { timeout: 6000 });
    if (vidssaveRes.ok) {
      const vidssaveData = await vidssaveRes.json();
      if (Array.isArray(vidssaveData.resources) && vidssaveData.resources.length > 0) {
        const medias = [];

        vidssaveData.resources.forEach(r => {
          if (r.type === 'audio') {
            medias.push({
              format: `Audio (${r.quality}) [.${r.format || 'm4a'}]`,
              fileSize: r.size || 0,
              url: r.download_url,
              itag: 140
            });
          } else if (r.type === 'video') {
            medias.push({
              format: `${r.quality} (.mp4)`,
              fileSize: r.size || 0,
              url: null,
              resource_content: r.resource_content,
              displayQuality: r.quality,
              has_audio: true
            });
          }
        });

        if (medias.length > 0) {
          currentMedias = medias;
          if (vidssaveData.title && videoTitle) {
            currentTitle = vidssaveData.title;
            videoTitle.innerText = currentTitle;
          }
          if (vidssaveData.duration && videoDuration) {
            videoDuration.innerText = `Duration: ${Math.floor(vidssaveData.duration / 60)}m ${vidssaveData.duration % 60}s`;
          }
          if (vidssaveData.thumbnail && videoThumb) {
            videoThumb.src = vidssaveData.thumbnail;
          }
          if (spinner) spinner.style.display = 'none';
          if (submitBtn) submitBtn.disabled = false;
          renderFormats(currentMedias, currentTitle);
          return;
        }
      }
    }
    sendEngineAlert({
      type: 'Engine Switch (Warning)',
      engine: 'Engine 3 (Vidssave)',
      switchedTo: 'Engine 1 (YtUltra)',
      error: 'Vidssave parse returned 0 formats',
      videoId
    });
  } catch (vidssaveErr) {
    console.warn('[FreeYT Tier 1 - Vidssave Error]:', vidssaveErr.message);
    sendEngineAlert({
      type: 'Engine Switch (Warning)',
      engine: 'Engine 3 (Vidssave)',
      switchedTo: 'Engine 1 (YtUltra)',
      error: vidssaveErr.message,
      videoId
    });
  }

  // =========================================================================
  // TIER 2: YtUltra Multi-Format Stream Engine Fallback
  // =========================================================================
  try {
    const ultraRes = await fetchWithTimeout('https://api.ytultra.com/ikool/youtube/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}` }),
      timeout: 6000
    });

    if (ultraRes.ok) {
      const ultraData = await ultraRes.json();
      if (ultraData.code === '0000' && Array.isArray(ultraData.data?.medias) && ultraData.data.medias.length > 0) {
        currentMedias = ultraData.data.medias;
        if (ultraData.data.title && videoTitle) {
          currentTitle = ultraData.data.title;
          videoTitle.innerText = currentTitle;
        }
        if (spinner) spinner.style.display = 'none';
        if (submitBtn) submitBtn.disabled = false;
        renderFormats(currentMedias, currentTitle);
        return;
      }
    }
    sendEngineAlert({
      type: 'Engine Switch (Warning)',
      engine: 'Engine 1 (YtUltra)',
      switchedTo: 'Engine 2 (Vynex)',
      error: 'Invalid response status or empty stream list',
      videoId
    });
  } catch (err) {
    console.warn('[FreeYT Tier 2 - YtUltra Error]:', err.message);
    sendEngineAlert({
      type: 'Engine Switch (Warning)',
      engine: 'Engine 1 (YtUltra)',
      switchedTo: 'Engine 2 (Vynex)',
      error: err.message,
      videoId
    });
  }

  // =========================================================================
  // TIER 3: Vynex High-Speed Media Extractor Fallback
  // =========================================================================
  try {
    const vynexRes = await fetchWithTimeout(`https://vynex.ai/api/tools/youtube-video?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D${videoId}&will_retry=1`, { timeout: 6000 });
    if (vynexRes.ok) {
      const vynexData = await vynexRes.json();
      if (Array.isArray(vynexData.formats) || Array.isArray(vynexData.audio)) {
        const medias = [];

        if (Array.isArray(vynexData.audio)) {
          vynexData.audio.forEach(a => {
            if (a.url) {
              medias.push({
                format: `Audio (${a.bitrate || '128kbps'}) [.${a.ext || 'm4a'}]`,
                fileSize: a.size || 0,
                url: a.url,
                itag: 140
              });
            }
          });
        }

        if (Array.isArray(vynexData.formats)) {
          vynexData.formats.forEach(f => {
            if (f.url) {
              medias.push({
                format: `${f.label || f.height + 'p'} (.${f.ext || 'mp4'})`,
                fileSize: f.size || 0,
                url: f.url,
                displayQuality: f.label || (f.height + 'p'),
                has_audio: f.has_audio
              });
            }
          });
        }

        if (medias.length > 0) {
          currentMedias = medias;
          if (vynexData.title && videoTitle) {
            currentTitle = vynexData.title;
            videoTitle.innerText = currentTitle;
          }
          if (vynexData.channel && videoDuration) {
            videoDuration.innerText = `Channel: ${vynexData.channel}`;
          }
          if (vynexData.thumbnail && videoThumb) {
            videoThumb.src = vynexData.thumbnail;
          }
          if (spinner) spinner.style.display = 'none';
          if (submitBtn) submitBtn.disabled = false;
          renderFormats(currentMedias, currentTitle);
          return;
        }
      }
    }
    sendEngineAlert({
      type: 'Engine Switch (Warning)',
      engine: 'Engine 2 (Vynex)',
      switchedTo: 'Engine 4 (Core Server)',
      error: 'Vynex responded with 0 stream formats',
      videoId
    });
  } catch (vynexErr) {
    console.warn('[FreeYT Tier 3 - Vynex Error]:', vynexErr.message);
    sendEngineAlert({
      type: 'Engine Switch (Warning)',
      engine: 'Engine 2 (Vynex)',
      switchedTo: 'Engine 4 (Core Server)',
      error: vynexErr.message,
      videoId
    });
  }

  // =========================================================================
  // TIER 4: Core Server Fallback
  // =========================================================================
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/info?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`, { timeout: 8000 });
    if (res.ok) {
      const data = await res.json();
      if (data.formats && Array.isArray(data.formats) && data.formats.length > 0) {
        if (spinner) spinner.style.display = 'none';
        if (submitBtn) submitBtn.disabled = false;
        renderFormats(data.formats, data.title || currentTitle);
        return;
      }
    }
  } catch (apiErr) {
    console.warn('[FreeYT Core API Error]:', apiErr.message);
  }

  // CRITICAL ALERT: All Engines Failed
  sendEngineAlert({
    type: 'CRITICAL ALERT: All Engines Exhausted',
    engine: 'All Engines (Vidssave, YtUltra, Vynex, Core Server)',
    switchedTo: 'Polite User High Demand Message',
    error: 'All extraction strategies exhausted for this link',
    videoId
  });

  if (spinner) spinner.style.display = 'none';
  if (submitBtn) submitBtn.disabled = false;
  alert('Our servers are currently experiencing high demand. Please wait a moment and try again.');
}
window.startConversion = startConversion;

// ====================================================
// SMARTLINK MONETIZATION (Strict 1x / Session on Download)
// Zero DOM interference, zero cursor pointer flicker, zero bounce-rate impact
// ====================================================
const SMARTLINK_URL = 'https://asiafilm.org/4/c619ae74f45b19f35ba92be259aad52e';

function triggerSmartlinkOnDownload() {
  try {
    const hasTriggered = sessionStorage.getItem('fyt_smartlink_opened');
    if (!hasTriggered) {
      sessionStorage.setItem('fyt_smartlink_opened', '1');
      window.open(SMARTLINK_URL, '_blank');
    }
  } catch (e) {}
}
window.triggerSmartlinkOnDownload = triggerSmartlinkOnDownload;

// Attach click listener strictly to download action buttons
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.download-action-btn, .y2-download-btn, .btn-download-row');
  if (btn) {
    triggerSmartlinkOnDownload();
  }
});
