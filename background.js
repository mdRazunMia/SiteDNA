chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'captureRegion') {
    const fmt = request.format || 'png';
    captureAndSendRegion(request.region, request.dims, sender.tab.id, fmt)
      .then(dataUrl => sendResponse({ success: true, dataUrl }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'captureSegment') {
    captureSegment(request.x, request.y, sender.tab.id)
      .then(dataUrl => sendResponse({ success: true, dataUrl }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'stitchAndCrop') {
    stitchAndCropRegion(request.segments, request.dims, request.region)
      .then(dataUrl => sendResponse({ success: true, dataUrl }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'captureViewport') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' })
      .then(dataUrl => sendResponse({ success: true, dataUrl }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function captureSegment(x, y, tabId) {
  await chrome.tabs.sendMessage(tabId, { action: 'scrollTo', x, y }).catch(() => {});
  await new Promise(r => setTimeout(r, 300));
  return chrome.tabs.captureVisibleTab(null, { format: 'png' });
}

async function captureAndSendRegion(region, dims, tabId, format) {
  const fitsViewport = region.x >= 0 && region.y >= 0 &&
    (region.x + region.width) <= dims.viewportWidth &&
    (region.y + region.height) <= dims.viewportHeight;

  if (fitsViewport) {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    return cropImage(dataUrl, region.viewportX, region.viewportY, region.width, region.height, dims.devicePixelRatio || 1, format);
  }

  const cols = Math.ceil(dims.width / dims.viewportWidth);
  const rows = Math.ceil(dims.height / dims.viewportHeight);
  const segments = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const sx = col * dims.viewportWidth;
      const sy = row * dims.viewportHeight;
      const dataUrl = await captureSegment(sx, sy, tabId);
      segments.push({ dataUrl, x: sx, y: sy });
    }
  }

  return stitchAndCropRegion(segments, dims, region, format);
}

function mimeFromFormat(format) {
  if (format === 'jpg' || format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  return 'image/png';
}

async function stitchAndCropRegion(segments, dims, region, format) {
  const dpr = dims.devicePixelRatio || 1;
  const fullWidth = dims.width * dpr;
  const fullHeight = dims.height * dpr;
  const mime = mimeFromFormat(format);

  const fullCanvas = new OffscreenCanvas(fullWidth, fullHeight);
  const ctx = fullCanvas.getContext('2d');

  for (const seg of segments) {
    const resp = await fetch(seg.dataUrl);
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);
    ctx.drawImage(bitmap, seg.x * dpr, seg.y * dpr);
  }

  const cropCanvas = new OffscreenCanvas(region.width * dpr, region.height * dpr);
  const cCtx = cropCanvas.getContext('2d');
  cCtx.drawImage(fullCanvas, region.x * dpr, region.y * dpr, region.width * dpr, region.height * dpr, 0, 0, region.width * dpr, region.height * dpr);

  const blob = await cropCanvas.convertToBlob({ type: mime, quality: format === 'jpg' ? 0.9 : undefined });
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function cropImage(dataUrl, x, y, w, h, dpr, format) {
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);
  const mime = mimeFromFormat(format);

  const canvas = new OffscreenCanvas(w * dpr, h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, x * dpr, y * dpr, w * dpr, h * dpr, 0, 0, w * dpr, h * dpr);

  const croppedBlob = await canvas.convertToBlob({ type: mime, quality: format === 'jpg' ? 0.9 : undefined });
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(croppedBlob);
  });
}
