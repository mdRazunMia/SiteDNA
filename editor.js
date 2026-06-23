document.addEventListener('DOMContentLoaded', function() {
  var editorId = new URLSearchParams(window.location.search).get('id') || 'default';

  var canvas = document.getElementById('editorCanvas');
  var ctx = canvas.getContext('2d');
  var canvasWrap = document.getElementById('canvasWrap');
  var editorSize = document.getElementById('editorSize');

  var toolbar = document.querySelector('.tool-grid');
  var colorInput = document.getElementById('annotationColor');
  var sizeInput = document.getElementById('annotationSize');
  var undoBtn = document.getElementById('annotationUndo');
  var clearBtn = document.getElementById('annotationClear');
  var formatSelect = document.getElementById('editorFormat');
  var downloadBtn = document.getElementById('downloadScreenshot');
  var copyBtn = document.getElementById('copyScreenshot');

  var currentTool = 'none';
  var undoStack = [];
  var baseImage = null;
  var currentFormat = 'png';
  var drawingState = { drawing: false, startX: 0, startY: 0, snapshot: null, penPoints: [] };

  // ===== Communication with popup / background =====
  chrome.runtime.onMessage.addListener(function(request) {
    if (request.action === 'loadScreenshot' && request.targetId === editorId) {
      loadScreenshot(request.dataUrl, request.format || 'png');
    }
  });

  chrome.runtime.sendMessage({ action: 'editorReady', id: editorId });

  // ===== Loading =====
  function loadScreenshot(dataUrl, format) {
    currentFormat = format || 'png';
    if (formatSelect) formatSelect.value = currentFormat;
    var img = new Image();
    img.onload = function() {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      baseImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
      undoStack = [baseImage];
      setTool('none');
      updateSizeLabel();
    };
    img.onerror = function() {
      alert('Failed to load screenshot.');
    };
    img.src = dataUrl;
  }

  function updateSizeLabel() {
    if (editorSize) editorSize.textContent = canvas.width + ' × ' + canvas.height + ' px';
  }

  // ===== Tools =====
  function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.tool-btn[data-tool]').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    canvas.style.cursor = tool === 'none' ? 'default' : 'crosshair';
  }

  if (toolbar) {
    toolbar.querySelectorAll('.tool-btn[data-tool]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        setTool(btn.dataset.tool);
      });
    });
  }

  function getColor() {
    return colorInput ? colorInput.value : '#ef4444';
  }

  function getSize() {
    return sizeInput ? parseInt(sizeInput.value, 10) : 4;
  }

  function getPoint(e) {
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width;
    var scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  function saveState() {
    var data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    undoStack.push(data);
    if (undoStack.length > 30) undoStack.shift();
  }

  function restoreState(data) {
    if (!data) return;
    ctx.putImageData(data, 0, 0);
  }

  function hexToRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
  }

  function drawArrow(ctx, fromX, fromY, toX, toY, color, width) {
    var head = Math.max(width * 3, 10);
    var dx = toX - fromX;
    var dy = toY - fromY;
    var angle = Math.atan2(dy, dx);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - head * Math.cos(angle - Math.PI / 6), toY - head * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(toX - head * Math.cos(angle + Math.PI / 6), toY - head * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawShape(ctx, startX, startY, endX, endY, color, size) {
    var x = Math.min(startX, endX);
    var y = Math.min(startY, endY);
    var w = Math.abs(endX - startX);
    var h = Math.abs(endY - startY);

    if (currentTool === 'rect') {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    } else if (currentTool === 'ellipse') {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.restore();
    } else if (currentTool === 'highlight') {
      ctx.save();
      ctx.fillStyle = hexToRgba(color, 0.35);
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    } else if (currentTool === 'arrow') {
      drawArrow(ctx, startX, startY, endX, endY, color, size);
    } else if (currentTool === 'blur') {
      ctx.save();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
  }

  function applyBlur(x1, y1, x2, y2) {
    var x = Math.min(x1, x2);
    var y = Math.min(y1, y2);
    var w = Math.abs(x2 - x1);
    var h = Math.abs(y2 - y1);
    if (w < 4 || h < 4) return;
    var off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    var octx = off.getContext('2d');
    octx.filter = 'blur(8px)';
    octx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
    ctx.drawImage(off, x, y);
  }

  function drawText(e) {
    var text = window.prompt('Enter annotation text:');
    if (!text) return;
    saveState();
    var point = getPoint(e);
    var color = getColor();
    var size = Math.max(getSize() * 3, 14);
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = 'bold ' + size + 'px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'top';
    var lines = text.split('\n');
    var lineHeight = size * 1.2;
    lines.forEach(function(line, i) {
      ctx.fillText(line, point.x, point.y + i * lineHeight);
    });
    ctx.restore();
  }

  // ===== Canvas events =====
  canvas.addEventListener('mousedown', function(e) {
    if (currentTool === 'none') return;
    e.preventDefault();
    if (currentTool === 'text') {
      drawText(e);
      return;
    }
    var point = getPoint(e);
    drawingState.drawing = true;
    drawingState.startX = point.x;
    drawingState.startY = point.y;
    drawingState.penPoints = [point];
    saveState();
    drawingState.snapshot = undoStack[undoStack.length - 1];
  });

  canvas.addEventListener('mousemove', function(e) {
    if (!drawingState.drawing) return;
    var point = getPoint(e);
    if (currentTool === 'pen') {
      ctx.save();
      ctx.strokeStyle = getColor();
      ctx.lineWidth = getSize();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      var last = drawingState.penPoints[drawingState.penPoints.length - 1];
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      ctx.restore();
      drawingState.penPoints.push(point);
    } else {
      restoreState(drawingState.snapshot);
      drawShape(ctx, drawingState.startX, drawingState.startY, point.x, point.y, getColor(), getSize());
    }
  });

  function finishStroke(e) {
    if (!drawingState.drawing) return;
    drawingState.drawing = false;
    var point = getPoint(e);
    if (currentTool === 'blur') {
      restoreState(drawingState.snapshot);
      applyBlur(drawingState.startX, drawingState.startY, point.x, point.y);
    } else if (currentTool !== 'pen') {
      restoreState(drawingState.snapshot);
      drawShape(ctx, drawingState.startX, drawingState.startY, point.x, point.y, getColor(), getSize());
    }
  }

  canvas.addEventListener('mouseup', finishStroke);
  canvas.addEventListener('mouseleave', finishStroke);

  // ===== Undo / Clear =====
  if (undoBtn) {
    undoBtn.addEventListener('click', function() {
      if (undoStack.length <= 1) return;
      undoStack.pop();
      restoreState(undoStack[undoStack.length - 1]);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function() {
      if (baseImage) {
        restoreState(baseImage);
        undoStack = [baseImage];
      }
    });
  }

  // ===== Export helpers =====
  function mimeFromFormat(format) {
    if (format === 'jpg' || format === 'jpeg') return 'image/jpeg';
    if (format === 'webp') return 'image/webp';
    return 'image/png';
  }

  function convertToSvg(dataUrl, callback) {
    var img = new Image();
    img.onload = function() {
      var w = img.naturalWidth;
      var h = img.naturalHeight;
      var svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + w + '" height="' + h + '">\n' +
        '  <image width="' + w + '" height="' + h + '" xlink:href="' + dataUrl + '"/>\n' +
        '</svg>';
      var svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
      var reader = new FileReader();
      reader.onload = function() { callback(reader.result); };
      reader.onerror = function() { callback(null); };
      reader.readAsDataURL(svgBlob);
    };
    img.onerror = function() { callback(null); };
    img.src = dataUrl;
  }

  function getAnnotatedDataUrl(format, callback) {
    var fmt = format || currentFormat || 'png';
    if (fmt === 'svg') {
      var pngUrl = canvas.toDataURL('image/png');
      convertToSvg(pngUrl, callback);
      return;
    }
    var mime = mimeFromFormat(fmt);
    canvas.toBlob(function(blob) {
      if (!blob) { callback(null); return; }
      var reader = new FileReader();
      reader.onload = function() { callback(reader.result); };
      reader.readAsDataURL(blob);
    }, mime, fmt === 'jpg' ? 0.92 : undefined);
  }

  function downloadDataUrl(dataUrl, filename, format) {
    if (format === 'png' || format === 'svg') {
      var a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }
    var mimeType = format === 'jpg' ? 'image/jpeg' : 'image/webp';
    var img = new Image();
    img.onload = function() {
      var c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      var cCtx = c.getContext('2d');
      cCtx.drawImage(img, 0, 0);
      c.toBlob(function(blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, mimeType, 0.92);
    };
    img.onerror = function() { alert('Failed to process image.'); };
    img.src = dataUrl;
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', function() {
      var format = formatSelect ? formatSelect.value : 'png';
      getAnnotatedDataUrl(format, function(url) {
        if (!url) { alert('Failed to prepare image.'); return; }
        downloadDataUrl(url, 'screenshot.' + format, format);
      });
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', function() {
      var format = formatSelect ? formatSelect.value : 'png';
      getAnnotatedDataUrl(format, function(url) {
        if (!url) { alert('Failed to prepare image.'); return; }
        if (format === 'svg') {
          fetch(url).then(function(resp) { return resp.text(); })
            .then(function(text) {
              navigator.clipboard.writeText(text).then(function() {
                copyBtn.textContent = 'Copied!';
                setTimeout(function() { copyBtn.textContent = 'Copy'; }, 1500);
              }).catch(function() { alert('Could not copy to clipboard.'); });
            }).catch(function() { alert('Failed to read SVG.'); });
          return;
        }
        var mimeType = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
        var img = new Image();
        img.onload = function() {
          var c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          var cCtx = c.getContext('2d');
          cCtx.drawImage(img, 0, 0);
          c.toBlob(function(blob) {
            if (!blob) { alert('Failed to convert for clipboard.'); return; }
            navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
              .then(function() {
                copyBtn.textContent = 'Copied!';
                setTimeout(function() { copyBtn.textContent = 'Copy'; }, 1500);
              })
              .catch(function() { alert('Could not copy to clipboard.'); });
          }, mimeType, 0.92);
        };
        img.onerror = function() { alert('Failed to process image.'); };
        img.src = url;
      });
    });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      if (undoStack.length > 1) {
        undoStack.pop();
        restoreState(undoStack[undoStack.length - 1]);
      }
    }
  });
});
