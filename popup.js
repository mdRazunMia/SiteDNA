document.addEventListener('DOMContentLoaded', function() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const downloadBtn = document.getElementById('downloadAll');
  const downloadDSBtn = document.getElementById('downloadDesignSystem');
  const statusDiv = document.getElementById('status');

  let extractedData = null;
  let pageUrl = '';
  let pageTitle = '';

  var statusTimeout = null;
  function showStatus(msg, type) {
    if (!statusDiv) return;
    if (statusTimeout) {
      clearTimeout(statusTimeout);
      statusTimeout = null;
    }
    statusDiv.textContent = msg;
    statusDiv.className = 'status show ' + type;
    statusDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (type === 'success') {
      statusTimeout = setTimeout(function() { statusDiv.textContent = ''; statusDiv.className = 'status'; }, 3000);
    }
  }

  // Tab switching
  tabBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      tabBtns.forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  function sendToTab(tab, msg, callback, retries) {
    retries = retries || 2;
    console.log('[sendToTab] sending', msg.action, 'to tab', tab.id, 'retries left:', retries);
    chrome.tabs.sendMessage(tab.id, msg, function(response) {
      if (chrome.runtime.lastError) {
        console.log('[sendToTab] error for', msg.action, ':', chrome.runtime.lastError.message);
        if (retries > 0) {
          if (retries === 2) {
            console.log('[sendToTab] injecting content.js');
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content.js']
            }, function() {});
          }
          setTimeout(function() { sendToTab(tab, msg, callback, retries - 1); }, 300);
        } else {
          console.log('[sendToTab] all retries exhausted for', msg.action);
          if (callback) callback(null);
        }
        return;
      }
      console.log('[sendToTab] success for', msg.action, ':', response ? (response.success ? 'ok' : 'fail') : 'no response');
      if (callback) callback(response);
    });
  }

  function ensureContentScript(tab, callback, attempts) {
    attempts = attempts || 3;
    console.log('[ensureContentScript] checking tab', tab.id, tab.url, 'attempts left:', attempts);
    if (!tab.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://') && !tab.url.startsWith('file://'))) {
      showStatus('This page does not support extraction.', 'error');
      emptyRender();
      return;
    }
    chrome.tabs.sendMessage(tab.id, { action: 'ping' }, function(response) {
      if (chrome.runtime.lastError || !response) {
        console.log('[ensureContentScript] ping failed:', chrome.runtime.lastError ? chrome.runtime.lastError.message : 'no response');
        if (attempts <= 1) {
          console.log('[ensureContentScript] last attempt, injecting content.js');
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          }, function() {
            if (chrome.runtime.lastError) {
              console.log('[ensureContentScript] injection failed:', chrome.runtime.lastError.message);
              showStatus('Could not inject content script.', 'error');
              emptyRender();
              return;
            }
            setTimeout(function() {
              chrome.tabs.sendMessage(tab.id, { action: 'ping' }, function(resp) {
                if (chrome.runtime.lastError || !resp) {
                  console.log('[ensureContentScript] post-inject ping failed');
                  showStatus('Content script not responding.', 'error');
                  emptyRender();
                  return;
                }
                console.log('[ensureContentScript] post-inject ping succeeded');
                callback(tab);
              });
            }, 150);
          });
        } else {
          console.log('[ensureContentScript] retrying in 200ms');
          setTimeout(function() { ensureContentScript(tab, callback, attempts - 1); }, 200);
        }
        return;
      }
      console.log('[ensureContentScript] ping succeeded');
      callback(tab);
    });
  }

  function emptyRender() {
    renderDesignSystem(getEmptyDesignSystem());
    renderImages([]);
  }

  // Extract everything via content script messaging
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs || !tabs[0]) {
      showStatus('Could not access current tab.', 'error');
      return;
    }
    const tab = tabs[0];
    pageUrl = tab.url || '';
    pageTitle = tab.title || '';

    ensureContentScript(tab, function() {
      // 1. Design System
      sendToTab(tab, { action: 'extractDesignSystem' }, function(response) {
        if (!response || !response.success) {
          showStatus('Design System: ' + (response && response.error ? response.error : 'No response'), 'error');
          renderDesignSystem(getEmptyDesignSystem());
          return;
        }
        extractedData = response.data || getEmptyDesignSystem();
        renderDesignSystem(extractedData);
      });

      // 2. Images
      sendToTab(tab, { action: 'extractImages' }, function(response) {
        const images = (response && response.success) ? response.data : [];
        renderImages(images);
      });

      // 3. Inspector state
      sendToTab(tab, { action: 'getInspectorState' }, function(response) {
        if (response && response.active) {
          updateInspectorUI(true, response.css || '');
        }
      });
    });
  });

  // Download Design System as .md
  if (downloadDSBtn) {
    downloadDSBtn.addEventListener('click', function() {
      if (!extractedData) {
        showStatus('No design system data yet.', 'error');
        return;
      }
      var md = generateMarkdown(extractedData, pageTitle, pageUrl);
      var blob = new Blob([md], { type: 'text/markdown' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'design-system.md';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showStatus('Design system exported as .md!', 'success');
    });
  }

  // Element Inspector
  var inspectorBtn = document.getElementById('toggleInspector');
  var inspectorStatus = document.getElementById('inspectorStatus');
  var inspectorStylesPanel = document.getElementById('inspectorStyles');
  var inspectorCode = document.getElementById('inspectorCode');
  var copyInspectorBtn = document.getElementById('copyInspectorStyles');
  var inspectorActive = false;
  var lastPickedCSS = '';

  function updateInspectorUI(active, css) {
    inspectorActive = active;
    if (inspectorStatus) {
      inspectorStatus.innerHTML = 'Inspector is <strong>' + (active ? 'ON' : 'OFF') + '</strong>';
      inspectorStatus.className = 'inspector-status ' + (active ? 'on' : 'off');
    }
    if (inspectorBtn) inspectorBtn.textContent = active ? 'Disable Inspector' : 'Enable Inspector';
    if (css && inspectorCode) {
      inspectorCode.textContent = css;
      if (inspectorStylesPanel) inspectorStylesPanel.style.display = 'block';
      lastPickedCSS = css;
    }
  }

  if (inspectorBtn) {
    inspectorBtn.addEventListener('click', function() {
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (!tabs || !tabs[0]) return;
        var tab = tabs[0];
        if (!tab.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) {
          showStatus('This page does not support inspection.', 'error');
          return;
        }
        var action = inspectorActive ? 'disableInspector' : 'enableInspector';
        sendToTab(tab, { action: action }, function(response) {
          if (!response || !response.success) {
            showStatus('Inspector error.', 'error');
            return;
          }
          updateInspectorUI(!inspectorActive, response.css || '');
        });
      });
    });
  }

  if (copyInspectorBtn) {
    copyInspectorBtn.addEventListener('click', function() {
      if (lastPickedCSS) {
        navigator.clipboard.writeText(lastPickedCSS);
        showStatus('CSS copied to clipboard!', 'success');
      }
    });
  }

  // Poll for picked element styles when inspector is active
  setInterval(function() {
    if (!inspectorActive) return;
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (!tabs || !tabs[0]) return;
      var tab = tabs[0];
      sendToTab(tab, { action: 'getPickedStyles' }, function(response) {
        if (!response || !response.css) return;
        if (response.css !== lastPickedCSS) {
          if (inspectorCode) inspectorCode.textContent = response.css;
          if (inspectorStylesPanel) inspectorStylesPanel.style.display = 'block';
          lastPickedCSS = response.css;
        }
      });
    });
  }, 800);

  // ===== COLOR PICKER =====
  var pickerBtn = document.getElementById('togglePicker');
  var pickerStatus = document.getElementById('pickerStatus');
  var pickedColorDiv = document.getElementById('pickedColor');
  var pickedSwatch = document.getElementById('pickedSwatch');
  var pickedHex = document.getElementById('pickedHex');
  var pickedRGB = document.getElementById('pickedRGB');
  var copyPickedBtn = document.getElementById('copyPickedColor');
  var colorHistoryDiv = document.getElementById('colorHistory');
  var colorHistoryList = document.getElementById('colorHistoryList');
  var clearHistoryBtn = document.getElementById('clearColorHistory');
  var pickerActive = false;
  var lastPickedColor = null;
  var colorHistory = [];

  function updatePickerUI(active, color) {
    pickerActive = active;
    if (pickerStatus) {
      pickerStatus.innerHTML = 'Picker is <strong>' + (active ? 'ON' : 'OFF') + '</strong>';
      pickerStatus.className = 'inspector-status ' + (active ? 'on' : 'off');
    }
    if (pickerBtn) pickerBtn.textContent = active ? 'Disable Picker' : 'Enable Picker';
    if (color && pickedColorDiv) {
      pickedColorDiv.style.display = 'block';
      if (pickedSwatch) pickedSwatch.style.backgroundColor = color.hex;
      if (pickedHex) pickedHex.textContent = color.hex;
      if (pickedRGB) pickedRGB.textContent = color.rgb;
      lastPickedColor = color.hex;
    }
  }

  function renderColorHistory() {
    if (!colorHistoryList || !colorHistoryDiv) return;
    colorHistoryDiv.style.display = colorHistory.length > 0 ? 'block' : 'none';
    colorHistoryList.innerHTML = '';
    colorHistory.forEach(function(c) {
      var chip = document.createElement('div');
      chip.className = 'history-chip';
      chip.innerHTML = '<div class="history-swatch" style="background:' + c.hex + '"></div><span class="history-hex">' + c.hex + '</span>';
      chip.addEventListener('click', function() {
        navigator.clipboard.writeText(c.hex);
        showStatus('Copied ' + c.hex + ' to clipboard!', 'success');
      });
      chip.title = 'Click to copy ' + c.hex;
      colorHistoryList.appendChild(chip);
    });
  }

  if (pickerBtn) {
    pickerBtn.addEventListener('click', function() {
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (!tabs || !tabs[0]) return;
        var tab = tabs[0];
        if (!tab.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) {
          showStatus('This page does not support the color picker.', 'error');
          return;
        }
        var action = pickerActive ? 'disableColorPicker' : 'enableColorPicker';
        sendToTab(tab, { action: action }, function(response) {
          if (!response || !response.success) {
            showStatus('Color picker error.', 'error');
            return;
          }
          updatePickerUI(!pickerActive, null);
        });
      });
    });
  }

  if (copyPickedBtn) {
    copyPickedBtn.addEventListener('click', function() {
      if (lastPickedColor) {
        navigator.clipboard.writeText(lastPickedColor);
        showStatus('Copied ' + lastPickedColor + '!', 'success');
      }
    });
  }

  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', function() {
      colorHistory = [];
      renderColorHistory();
    });
  }

  // Poll for picked colors and picker state
  setInterval(function() {
    if (!pickerActive) return;
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (!tabs || !tabs[0]) return;
      var tab = tabs[0];
      // Check if picker is still active on the page
      sendToTab(tab, { action: 'getPickerState' }, function(stateResp) {
        if (stateResp && !stateResp.active) {
          // Picker was auto-disabled after picking a color
          updatePickerUI(false, null);
          return;
        }
      });
      sendToTab(tab, { action: 'getPickedColor' }, function(response) {
        if (!response || !response.color) return;
        var c = response.color;
        if (c.hex !== lastPickedColor) {
          updatePickerUI(true, c);
          if (!colorHistory.find(function(h) { return h.hex === c.hex; })) {
            colorHistory.unshift(c);
            if (colorHistory.length > 20) colorHistory.pop();
            renderColorHistory();
          }
        }
      });
    });
  }, 500);

  // Download Images as ZIP
  if (downloadBtn) {
    downloadBtn.addEventListener('click', function() {
      var formatEl = document.getElementById('imageFormat');
      var format = formatEl ? formatEl.value : 'original';
      showStatus('Preparing ZIP...', 'info');

      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (!tabs || !tabs[0]) return;
        var tab = tabs[0];
        sendToTab(tab, { action: 'extractImages' }, function(response) {
          if (!response || !response.success) {
              showStatus('Could not fetch images.', 'error');
              return;
            }
            var images = response.data || [];
            if (images.length === 0) {
              showStatus('No images found.', 'error');
              return;
            }

            var zip = new JSZip();
            var folder = zip.folder('images');
            var completed = 0;

            function processNext(i) {
              if (i >= images.length) {
                zip.generateAsync({ type: 'blob' }).then(function(content) {
                  var url = URL.createObjectURL(content);
                  var a = document.createElement('a');
                  a.href = url;
                  a.download = 'images.zip';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  showStatus('Downloaded ' + completed + ' images as ZIP!', 'success');
                });
                return;
              }
              fetchImageAsBlob(images[i].src, format).then(function(blob) {
                var ext = format === 'original' ? images[i].ext : format;
                if (ext === 'jpeg') ext = 'jpg';
                folder.file('image_' + String(i + 1).padStart(3, '0') + '.' + ext, blob);
                completed++;
                showStatus('Zipping ' + completed + '/' + images.length + '...', 'info');
                processNext(i + 1);
              }).catch(function(err) {
                console.error('Failed:', images[i].src, err);
                processNext(i + 1);
              });
            }

            processNext(0);
          });
        });
      });
  }
  // ===== SCREENSHOT =====

  var captureBtn = document.getElementById('captureScreenshot');
  var screenshotPreview = document.getElementById('screenshotPreview');
  var screenshotImage = document.getElementById('screenshotImage');
  var downloadScreenshotBtn = document.getElementById('downloadScreenshot');
  var copyScreenshotBtn = document.getElementById('copyScreenshot');
  var screenshotFormat = document.getElementById('screenshotFormat');
  var screenshotProgress = document.getElementById('screenshotProgress');
  var progressFill = document.getElementById('progressFill');
  var progressText = document.getElementById('progressText');
  var isCapturing = false;

  function getScreenshotMode() {
    var checked = document.querySelector('input[name="screenshotMode"]:checked');
    return checked ? checked.value : 'visible';
  }

  function showScreenshotProgress(show) {
    if (!screenshotProgress) return;
    screenshotProgress.style.display = show ? 'block' : 'none';
  }

  function setScreenshotProgress(pct, text) {
    if (progressFill) progressFill.style.width = pct + '%';
    if (progressText) progressText.textContent = text || '';
  }

  if (captureBtn) {
    captureBtn.addEventListener('click', function() {
      if (isCapturing) return;

      var mode = getScreenshotMode();

      if (mode === 'region') {
        var fmt = screenshotFormat ? screenshotFormat.value : 'png';
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
          if (!tabs || !tabs[0]) { window.close(); return; }
          var tab = tabs[0];
          ensureContentScript(tab, function() {
            chrome.tabs.sendMessage(tab.id, { action: 'startRegionSelect', format: fmt }, function() {
              window.close();
            });
          });
        });
        return;
      }

      isCapturing = true;
      captureBtn.disabled = true;
      captureBtn.textContent = 'Capturing...';
      if (screenshotPreview) screenshotPreview.style.display = 'none';

      if (mode === 'visible') {
        captureVisibleScreenshot();
      } else {
        captureFullPageScreenshot();
      }
    });
  }

  function captureVisibleScreenshot() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (!tabs || !tabs[0]) {
        showStatus('Could not access tab.', 'error');
        resetCaptureBtn();
        return;
      }
      var fmt = screenshotFormat ? screenshotFormat.value : 'png';
      chrome.tabs.captureVisibleTab(null, { format: 'png' }, function(dataUrl) {
        if (chrome.runtime.lastError) {
          showStatus('Screenshot failed: ' + chrome.runtime.lastError.message, 'error');
          resetCaptureBtn();
          return;
        }
        if (fmt !== 'png') {
          convertDataUrl(dataUrl, fmt, function(converted) {
            displayScreenshot(converted);
            resetCaptureBtn();
          });
        } else {
          displayScreenshot(dataUrl);
          resetCaptureBtn();
        }
      });
    });
  }

  function captureFullPageScreenshot() {
    var fmt = screenshotFormat ? screenshotFormat.value : 'png';
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (!tabs || !tabs[0]) {
        showStatus('Could not access tab.', 'error');
        resetCaptureBtn();
        return;
      }
      var tab = tabs[0];

      ensureContentScript(tab, function() {
        chrome.tabs.sendMessage(tab.id, { action: 'getPageDimensions' }, function(dims) {
          if (chrome.runtime.lastError || !dims || !dims.success) {
            showStatus('Could not get page dimensions.', 'error');
            resetCaptureBtn();
            return;
          }

          var cols = Math.ceil(dims.width / dims.viewportWidth);
          var rows = Math.ceil(dims.height / dims.viewportHeight);
          var total = cols * rows;
          var captured = 0;
          var segments = [];

          showScreenshotProgress(true);
          setScreenshotProgress(0, 'Preparing capture...');

          function captureSegment(col, row) {
            var x = col * dims.viewportWidth;
            var y = row * dims.viewportHeight;

            chrome.tabs.sendMessage(tab.id, { action: 'scrollTo', x: x, y: y }, function() {
              setTimeout(function() {
                chrome.tabs.captureVisibleTab(null, { format: 'png' }, function(dataUrl) {
                  if (chrome.runtime.lastError) {
                    showStatus('Capture failed at segment ' + (captured + 1), 'error');
                    resetCaptureBtn();
                    showScreenshotProgress(false);
                    return;
                  }

                  segments.push({
                    dataUrl: dataUrl,
                    x: x,
                    y: y,
                    width: dims.viewportWidth,
                    height: dims.viewportHeight
                  });
                  captured++;
                  var pct = Math.round((captured / total) * 100);
                  setScreenshotProgress(pct, 'Capturing ' + captured + '/' + total + '...');

                  if (captured >= total) {
                    stitchFullPageScreenshot(segments, dims, fmt);
                  } else {
                    var nextCol = col + 1;
                    var nextRow = row;
                    if (nextCol >= cols) {
                      nextCol = 0;
                      nextRow = row + 1;
                    }
                    setTimeout(function() {
                      captureSegment(nextCol, nextRow);
                    }, 200);
                  }
                });
              }, 250);
            });
          }

          captureSegment(0, 0);
        });
      });
    });
  }

  function stitchFullPageScreenshot(segments, dims, fmt) {
    setScreenshotProgress(95, 'Stitching...');
    var loadPromises = segments.map(function(seg) {
      return new Promise(function(resolve) {
        var img = new Image();
        img.onload = function() { resolve({ img: img, seg: seg }); };
        img.onerror = function() { resolve(null); };
        img.src = seg.dataUrl;
      });
    });

    Promise.all(loadPromises).then(function(results) {
      var validResults = results.filter(function(r) { return r !== null; });
      if (validResults.length === 0) {
        showStatus('Failed to process screenshot segments.', 'error');
        resetCaptureBtn();
        showScreenshotProgress(false);
        return;
      }

      var canvas = document.createElement('canvas');
      canvas.width = dims.width * dims.devicePixelRatio;
      canvas.height = dims.height * dims.devicePixelRatio;
      var ctx = canvas.getContext('2d');
      var dpr = dims.devicePixelRatio;

      validResults.forEach(function(r) {
        var img = r.img;
        var seg = r.seg;
        ctx.drawImage(img, seg.x * dpr, seg.y * dpr, img.width, img.height);
      });

      var scaledCanvas = document.createElement('canvas');
      scaledCanvas.width = dims.width;
      scaledCanvas.height = dims.height;
      var sCtx = scaledCanvas.getContext('2d');
      sCtx.drawImage(canvas, 0, 0, dims.width, dims.height);

      var dataUrl = scaledCanvas.toDataURL('image/png');
      if (fmt && fmt !== 'png') {
        convertDataUrl(dataUrl, fmt, function(converted) {
          showScreenshotProgress(false);
          displayScreenshot(converted);
          resetCaptureBtn();
        });
      } else {
        showScreenshotProgress(false);
        displayScreenshot(dataUrl);
        resetCaptureBtn();
      }
    });
  }

  var currentScreenshotDataUrl = null;

  function displayScreenshot(dataUrl) {
    currentScreenshotDataUrl = dataUrl;
    if (screenshotImage) screenshotImage.src = dataUrl;
    if (screenshotPreview) screenshotPreview.style.display = 'block';
    screenshotPreview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    showStatus('Screenshot captured!', 'success');
  }

  function resetCaptureBtn() {
    isCapturing = false;
    if (captureBtn) {
      captureBtn.disabled = false;
      captureBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>\n          Capture Screenshot';
    }
    showScreenshotProgress(false);
  }

  if (downloadScreenshotBtn) {
    downloadScreenshotBtn.addEventListener('click', function() {
      if (!currentScreenshotDataUrl) {
        showStatus('No screenshot to download.', 'error');
        return;
      }
      var format = screenshotFormat ? screenshotFormat.value : 'png';
      downloadDataUrl(currentScreenshotDataUrl, 'screenshot.' + format, format);
    });
  }

  function convertDataUrl(dataUrl, format, callback) {
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      var mimeType = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
      canvas.toBlob(function(blob) {
        if (!blob) { callback(null); return; }
        var reader = new FileReader();
        reader.onload = function() { callback(reader.result); };
        reader.readAsDataURL(blob);
      }, mimeType, format === 'jpg' ? 0.9 : undefined);
    };
    img.src = dataUrl;
  }

  function downloadDataUrl(dataUrl, filename, format) {
    if (format === 'png') {
      var a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showStatus('Downloaded ' + filename + '!', 'success');
      return;
    }

    var mimeType = format === 'jpg' ? 'image/jpeg' : 'image/webp';
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(function(blob) {
        if (!blob) { showStatus('Failed to convert format.', 'error'); return; }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showStatus('Downloaded ' + filename + '!', 'success');
      }, mimeType, 0.92);
    };
    img.onerror = function() { showStatus('Failed to process image.', 'error'); };
    img.src = dataUrl;
  }

  if (copyScreenshotBtn) {
    copyScreenshotBtn.addEventListener('click', function() {
      if (!currentScreenshotDataUrl) {
        showStatus('No screenshot to copy.', 'error');
        return;
      }
      var format = screenshotFormat ? screenshotFormat.value : 'png';
      var mimeType = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';

      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(function(blob) {
          if (!blob) { showStatus('Failed to convert for clipboard.', 'error'); return; }
          navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
            .then(function() { showStatus('Copied to clipboard!', 'success'); })
            .catch(function() { showStatus('Could not copy to clipboard.', 'error'); });
        }, mimeType, 0.92);
      };
      img.onerror = function() { showStatus('Failed to process image.', 'error'); };
      img.src = currentScreenshotDataUrl;
    });
  }

  // ===== RENDERERS =====

  function renderDesignSystem(data) {
    if (!data) data = getEmptyDesignSystem();

    var colorCount = document.getElementById('colorCount');
    var typographyCount = document.getElementById('typographyCount');
    var fontCount = document.getElementById('fontCount');
    var spacingCount = document.getElementById('spacingCount');
    var shadowCount = document.getElementById('shadowCount');
    var radiusCount = document.getElementById('radiusCount');

    if (colorCount) colorCount.textContent = (data.colors || []).length + ' colors';
    if (typographyCount) typographyCount.textContent = (data.typography || []).length + ' styles';
    if (fontCount) fontCount.textContent = (data.fonts || []).length + ' fonts';
    if (spacingCount) spacingCount.textContent = (data.spacing || []).length + ' values';
    if (shadowCount) shadowCount.textContent = (data.shadows || []).length + ' values';
    if (radiusCount) radiusCount.textContent = (data.radius || []).length + ' values';

    // Colors
    var colorsContainer = document.getElementById('colors');
    if (colorsContainer) {
      colorsContainer.innerHTML = '';
      var colors = data.colors || [];
      if (colors.length > 0) {
        colors.forEach(function(item) {
          var hex = toHex(item.value);
          var div = document.createElement('div');
          div.className = 'color-card';
          div.innerHTML = '<div class="color-swatch" style="background-color: ' + item.value + '"></div><span class="color-hex">' + hex + '</span><span class="color-role">' + (item.role || 'color') + '</span>';
          div.addEventListener('click', function() {
            navigator.clipboard.writeText(hex);
            showStatus('Copied ' + hex + ' to clipboard!', 'success');
          });
          colorsContainer.appendChild(div);
        });
      } else {
        colorsContainer.innerHTML = '<p style="font-size:12px;color:#94a3b8;">No colors found.</p>';
      }
    }

    // Typography
    var typographyContainer = document.getElementById('typography');
    if (typographyContainer) {
      typographyContainer.innerHTML = '';
      var typography = data.typography || [];
      if (typography.length > 0) {
        typography.forEach(function(t) {
          var div = document.createElement('div');
          div.className = 'type-card';
          var family = (t.fontFamily || 'sans-serif').split(',')[0];
          div.innerHTML = '<div class="type-header"><span class="type-tag">' + t.tag + '</span><div class="type-preview" style="font-family:' + (t.fontFamily || 'sans-serif') + ';font-size:' + (t.fontSize || 'inherit') + ';font-weight:' + (t.fontWeight || 'normal') + ';color:' + (t.color || '#000') + ';line-height:' + (t.lineHeight || 'normal') + ';letter-spacing:' + (t.letterSpacing || 'normal') + ';">The quick brown fox</div></div><div class="type-meta"><span>' + (t.fontSize || '-') + '</span><span>' + (t.fontWeight || '-') + '</span><span>' + (t.lineHeight || '-') + '</span><span>' + (t.letterSpacing || '-') + '</span><span>' + family + '</span></div>';
          typographyContainer.appendChild(div);
        });
      } else {
        typographyContainer.innerHTML = '<p style="font-size:12px;color:#94a3b8;">No typography found.</p>';
      }
    }

    // Fonts
    var fontsContainer = document.getElementById('fonts');
    if (fontsContainer) {
      fontsContainer.innerHTML = '';
      var fonts = data.fonts || [];
      if (fonts.length > 0) {
        fonts.forEach(function(font) {
          var div = document.createElement('div');
          div.className = 'font-card';
          div.innerHTML = '<span class="font-preview" style="font-family:' + font + '">Aa</span><span class="font-name">' + font + '</span>';
          div.addEventListener('click', function() {
            navigator.clipboard.writeText(font);
            showStatus('Copied ' + font, 'success');
          });
          fontsContainer.appendChild(div);
        });
      } else {
        fontsContainer.innerHTML = '<p style="font-size:12px;color:#94a3b8;">No fonts found.</p>';
      }
    }

    // Spacing
    var spacingContainer = document.getElementById('spacing');
    if (spacingContainer) {
      spacingContainer.innerHTML = '';
      var spacing = data.spacing || [];
      if (spacing.length > 0) {
        spacing.forEach(function(val) {
          var span = document.createElement('span');
          span.className = 'spacing-chip';
          span.textContent = val;
          span.addEventListener('click', function() {
            navigator.clipboard.writeText(val);
            showStatus('Copied ' + val, 'success');
          });
          spacingContainer.appendChild(span);
        });
      } else {
        spacingContainer.innerHTML = '<p style="font-size:12px;color:#94a3b8;">No spacing found.</p>';
      }
    }

    // Shadows
    var shadowContainer = document.getElementById('shadows');
    if (shadowContainer) {
      shadowContainer.innerHTML = '';
      var shadows = data.shadows || [];
      if (shadows.length > 0) {
        shadows.forEach(function(s) {
          var div = document.createElement('div');
          div.className = 'shadow-card';
          div.innerHTML = '<div class="shadow-preview" style="box-shadow: ' + s + '"></div><span class="shadow-text">' + s + '</span>';
          shadowContainer.appendChild(div);
        });
      } else {
        shadowContainer.innerHTML = '<p style="font-size:12px;color:#94a3b8;">No shadows found.</p>';
      }
    }

    // Radius
    var radiusContainer = document.getElementById('radius');
    if (radiusContainer) {
      radiusContainer.innerHTML = '';
      var radius = data.radius || [];
      if (radius.length > 0) {
        radius.forEach(function(r) {
          var div = document.createElement('div');
          div.className = 'radius-card';
          div.innerHTML = '<div class="radius-visual" style="border-radius: ' + r + ';"></div><span class="radius-value">' + r + '</span>';
          radiusContainer.appendChild(div);
        });
      } else {
        radiusContainer.innerHTML = '<p style="font-size:12px;color:#94a3b8;">No border radius found.</p>';
      }
    }
  }

  function renderImages(images) {
    var countDiv = document.getElementById('imageCount');
    var previewDiv = document.getElementById('imagePreview');
    if (!previewDiv) return;
    previewDiv.innerHTML = '';

    if (!images || images.length === 0) {
      if (countDiv) countDiv.textContent = '0 images found';
      previewDiv.innerHTML = '<p style="font-size:12px;color:#94a3b8;">No images found.</p>';
      return;
    }

    if (countDiv) countDiv.textContent = images.length + ' images found';

    images.forEach(function(img, index) {
      var div = document.createElement('div');
      div.className = 'image-item';
      var imgEl = document.createElement('img');
      imgEl.src = img.src;
      imgEl.alt = '';
      imgEl.loading = 'lazy';
      imgEl.addEventListener('error', function() { imgEl.style.display = 'none'; });
      div.appendChild(imgEl);
      var actionsDiv = document.createElement('div');
      actionsDiv.className = 'image-actions';
      actionsDiv.innerHTML =
        '<select class="image-format-select" title="Choose format">' +
        '<option value="global">Global</option>' +
        '<option value="original">Original</option>' +
        '<option value="png">PNG</option>' +
        '<option value="jpg">JPG</option>' +
        '<option value="webp">WebP</option>' +
        '</select>' +
        '<button class="btn-download-img" title="Download image">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
        '</button>';
      div.appendChild(actionsDiv);
      var btn = div.querySelector('.btn-download-img');
      var sel = div.querySelector('.image-format-select');
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        downloadSingleImage(img.src, img.ext, index, sel);
      });
      previewDiv.appendChild(div);
    });
  }

  function downloadSingleImage(src, originalExt, index, formatSelect) {
    var perImageFormat = formatSelect ? formatSelect.value : 'global';
    var formatEl = document.getElementById('imageFormat');
    var format = perImageFormat === 'global' ? (formatEl ? formatEl.value : 'original') : perImageFormat;
    showStatus('Downloading image ' + (index + 1) + ' (' + format + ')...', 'info');
    fetchImageAsBlob(src, format).then(function(blob) {
      var ext = format === 'original' ? originalExt : format;
      if (ext === 'jpeg') ext = 'jpg';
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'image_' + String(index + 1).padStart(3, '0') + '.' + ext;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showStatus('Image ' + (index + 1) + ' downloaded!', 'success');
    }).catch(function(err) {
      console.error('Failed to download image:', err);
      showStatus('Failed to download image ' + (index + 1) + '.', 'error');
    });
  }

  function fetchImageAsBlob(src, format) {
    if (format === 'original') {
      return fetch(src).then(function(r) {
        if (!r.ok) throw new Error('Failed to fetch');
        return r.blob();
      });
    }
    return new Promise(function(resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function() {
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        var mimeType = 'image/png';
        if (format === 'jpg' || format === 'jpeg') mimeType = 'image/jpeg';
        else if (format === 'webp') mimeType = 'image/webp';
        canvas.toBlob(function(blob) {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob failed'));
        }, mimeType, 0.92);
      };
      img.onerror = function() { reject(new Error('Failed to load image')); };
      img.src = src;
    });
  }

  // ===== MARKDOWN GENERATOR =====

  function generateMarkdown(data, title, url) {
    var now = new Date().toLocaleString();
    var md = '# Design System Analysis\n\n';
    md += '> **Source:** [' + (title || 'Unknown') + '](' + (url || '') + ')\n';
    md += '> **Extracted:** ' + now + '\n\n';
    md += '---\n\n';

    var colors = data.colors || [];
    md += '## Color Palette\n\n';
    md += '| Role | Color | Hex / Value |\n';
    md += '|------|-------|-------------|\n';
    if (colors.length > 0) {
      colors.forEach(function(c) {
        md += '| ' + (c.role || '-') + ' | `' + c.value + '` | `' + c.value + '` |\n';
      });
    } else {
      md += '| - | - | No colors detected |\n';
    }
    md += '\n';

    var typography = data.typography || [];
    md += '## Typography\n\n';
    md += '| Tag | Font Size | Weight | Line Height | Letter Spacing | Font Family | Color |\n';
    md += '|-----|-----------|--------|-------------|----------------|-------------|-------|\n';
    if (typography.length > 0) {
      typography.forEach(function(t) {
        var fam = (t.fontFamily || '').split(',')[0] || '-';
        md += '| ' + (t.tag || '-') + ' | ' + (t.fontSize || '-') + ' | ' + (t.fontWeight || '-') + ' | ' + (t.lineHeight || '-') + ' | ' + (t.letterSpacing || '-') + ' | ' + fam + ' | ' + (t.color || '-') + ' |\n';
      });
    } else {
      md += '| - | - | - | - | - | - | - |\n';
    }
    md += '\n';

    var fonts = data.fonts || [];
    md += '## Font Families\n\n';
    if (fonts.length > 0) {
      fonts.forEach(function(f) { md += '- `' + f + '`\n'; });
    } else {
      md += '- No fonts detected\n';
    }
    md += '\n';

    var spacing = data.spacing || [];
    md += '## Spacing Scale\n\n';
    md += 'Unique margin and padding values used across the site.\n\n';
    if (spacing.length > 0) {
      md += '| Token | Value |\n';
      md += '|-------|-------|\n';
      spacing.forEach(function(s, i) {
        md += '| spacing-' + (i + 1) + ' | ' + s + ' |\n';
      });
    } else {
      md += 'No spacing values detected.\n';
    }
    md += '\n';

    var shadows = data.shadows || [];
    md += '## Shadows & Effects\n\n';
    if (shadows.length > 0) {
      shadows.forEach(function(s, i) {
        md += '### Shadow ' + (i + 1) + '\n\n';
        md += '```css\n' + s + '\n```\n\n';
      });
    } else {
      md += 'No shadows detected.\n';
    }
    md += '\n';

    var radius = data.radius || [];
    md += '## Border Radius\n\n';
    if (radius.length > 0) {
      radius.forEach(function(r) { md += '- `' + r + '`\n'; });
    } else {
      md += 'No border radius values detected.\n';
    }
    md += '\n';

    md += '---\n\n';
    md += '*Generated by Design System Analyzer Chrome Extension*\n';

    return md;
  }

  function toHex(color) {
    var ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = color;
    var normalized = ctx.fillStyle;
    if (normalized.charAt(0) === '#') return normalized;
    var rgb = normalized.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!rgb) return color;
    var r = parseInt(rgb[1], 10);
    var g = parseInt(rgb[2], 10);
    var b = parseInt(rgb[3], 10);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function getEmptyDesignSystem() {
    return { colors: [], fonts: [], typography: [], spacing: [], shadows: [], radius: [] };
  }
});
