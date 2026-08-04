(function () {
  const utils = window.ByoseSearchUtils;
  const MAX_LABELS = 5;
  const MODEL_OPTIONS = { version: 2, alpha: 0.75 };

  const COLOR_PALETTE = [
    { name: 'black', rgb: [32, 35, 41] },
    { name: 'white', rgb: [243, 244, 246] },
    { name: 'gray', rgb: [130, 136, 144] },
    { name: 'red', rgb: [194, 50, 61] },
    { name: 'orange', rgb: [226, 129, 45] },
    { name: 'yellow', rgb: [219, 188, 64] },
    { name: 'green', rgb: [54, 144, 84] },
    { name: 'blue', rgb: [59, 108, 187] },
    { name: 'purple', rgb: [122, 90, 176] },
    { name: 'pink', rgb: [212, 122, 151] },
    { name: 'brown', rgb: [122, 82, 52] },
    { name: 'beige', rgb: [207, 188, 152] }
  ];

  const OBJECT_RULES = [
    { token: 'shoes', match: /shoe|sneaker|trainer|boot|sandal|loafer|running/ },
    { token: 'bag', match: /bag|handbag|backpack|purse|wallet|tote/ },
    { token: 'watch', match: /watch|smartwatch|clock|wristwatch/ },
    { token: 'tv', match: /tv|television|monitor|screen|display/ },
    { token: 'phone', match: /phone|iphone|android|smartphone|mobile|cellphone/ },
    { token: 'shirt', match: /shirt|tshirt|tee|jersey|top|fashion/ }
  ];

  const STYLE_RULES = [
    { token: 'sport', match: /sport|sports|running|athletic|sneaker|trainer|jersey/ },
    { token: 'classic', match: /classic|formal|timeless|luxury|leather/ },
    { token: 'casual', match: /casual|everyday|daily|shirt|tee|fashion/ },
    { token: 'smart', match: /smart|digital|android|electronics|screen|device|tech/ },
    { token: 'leather', match: /leather/ }
  ];

  let modelPromise = null;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function rgbDistance(left, right) {
    return Math.sqrt(
      Math.pow((left[0] || 0) - (right[0] || 0), 2)
      + Math.pow((left[1] || 0) - (right[1] || 0), 2)
      + Math.pow((left[2] || 0) - (right[2] || 0), 2)
    );
  }

  function getNearestColor(rgb) {
    return COLOR_PALETTE.reduce((closest, candidate) => {
      const distance = rgbDistance(candidate.rgb, rgb);
      if (!closest || distance < closest.distance) {
        return { name: candidate.name, rgb: candidate.rgb, distance };
      }
      return closest;
    }, null);
  }

  function rgbToHsl(red, green, blue) {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;

    if (max === min) {
      return { h: 0, s: 0, l: lightness };
    }

    const delta = max - min;
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue = 0;

    switch (max) {
      case r:
        hue = (g - b) / delta + (g < b ? 6 : 0);
        break;
      case g:
        hue = (b - r) / delta + 2;
        break;
      default:
        hue = (r - g) / delta + 4;
        break;
    }

    return { h: hue / 6, s: saturation, l: lightness };
  }

  function readPreview(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        resolve('');
        return;
      }

      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Preview read failed'));
      reader.readAsDataURL(file);
    });
  }

  function fileToImage(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Unable to load the selected image.'));
      };
      image.src = objectUrl;
    });
  }

  function getImageSnapshot(image, size) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    if (!context) {
      return null;
    }

    const targetSize = size || 96;
    canvas.width = targetSize;
    canvas.height = targetSize;
    context.drawImage(image, 0, 0, targetSize, targetSize);

    return {
      canvas,
      context,
      imageData: context.getImageData(0, 0, targetSize, targetSize)
    };
  }

  function extractPalette(image) {
    const snapshot = getImageSnapshot(image, 72);

    if (!snapshot) {
      return {
        colors: [],
        primaryColor: null,
        averageSaturation: 0,
        averageLightness: 0,
        topShare: 0,
        contrast: 0
      };
    }

    const { data } = snapshot.imageData;
    const buckets = new Map();
    let total = 0;
    let saturationTotal = 0;
    let lightnessTotal = 0;
    let minLightness = 1;
    let maxLightness = 0;

    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      if (alpha < 128) {
        continue;
      }

      const red = Math.round(data[index] / 32) * 32;
      const green = Math.round(data[index + 1] / 32) * 32;
      const blue = Math.round(data[index + 2] / 32) * 32;
      const key = `${red},${green},${blue}`;
      const hsl = rgbToHsl(data[index], data[index + 1], data[index + 2]);

      saturationTotal += hsl.s;
      lightnessTotal += hsl.l;
      minLightness = Math.min(minLightness, hsl.l);
      maxLightness = Math.max(maxLightness, hsl.l);
      total += 1;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }

    const colors = Array.from(buckets.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([key, count]) => {
        const rgb = key.split(',').map(Number);
        const nearest = getNearestColor(rgb);
        return {
          rgb,
          name: nearest ? nearest.name : 'neutral',
          prominence: count / Math.max(total, 1)
        };
      });

    return {
      colors,
      primaryColor: colors[0] || null,
      averageSaturation: saturationTotal / Math.max(total, 1),
      averageLightness: lightnessTotal / Math.max(total, 1),
      topShare: colors[0] ? colors[0].prominence : 0,
      contrast: maxLightness - minLightness
    };
  }

  function inferObjects(labelText, fileName) {
    const joined = `${labelText} ${utils.normalizeText(fileName)}`;
    const inferred = new Set();

    OBJECT_RULES.forEach((rule) => {
      if (rule.match.test(joined)) {
        inferred.add(rule.token);
      }
    });

    return Array.from(inferred);
  }

  function inferPatterns(palette, labelText) {
    const patterns = new Set();
    const colorCount = Array.isArray(palette.colors) ? palette.colors.length : 0;

    if ((palette.topShare || 0) >= 0.58) {
      patterns.add('solid');
    }

    if ((palette.topShare || 0) < 0.45 && colorCount >= 3) {
      patterns.add('multi-tone');
    }

    if ((palette.contrast || 0) > 0.5) {
      patterns.add('high-contrast');
    }

    if (/striped|plaid|pattern/.test(labelText)) {
      patterns.add('patterned');
    }

    if (!patterns.size) {
      patterns.add('clean');
    }

    return Array.from(patterns);
  }

  function inferStyles(objects, labelText, palette, patterns) {
    const inferred = new Set();

    STYLE_RULES.forEach((rule) => {
      if (rule.match.test(labelText)) {
        inferred.add(rule.token);
      }
    });

    if (objects.includes('shoes')) {
      inferred.add('sport');
      inferred.add('casual');
    }

    if (objects.includes('bag')) {
      inferred.add('classic');
      if ((palette.primaryColor && ['brown', 'black', 'beige'].includes(palette.primaryColor.name)) || /leather/.test(labelText)) {
        inferred.add('leather');
      }
    }

    if (objects.includes('watch') || objects.includes('phone') || objects.includes('tv')) {
      inferred.add('smart');
      inferred.add('modern');
    }

    if (objects.includes('shirt')) {
      inferred.add('casual');
    }

    if (patterns.includes('solid')) {
      inferred.add('minimal');
    }

    return Array.from(inferred);
  }

  function buildTokens(file, labels, objects, colors, styles, patterns) {
    const tokenSet = new Set(utils.expandTokens(utils.tokenize(file && file.name ? file.name : '')));

    labels.forEach((entry) => {
      utils.expandTokens(utils.tokenize(entry.label)).forEach((token) => tokenSet.add(token));
    });

    objects.concat(styles, patterns, colors.map((entry) => entry.name)).forEach((token) => {
      if (token) {
        tokenSet.add(token);
      }
    });

    return Array.from(tokenSet);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-byose-src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === 'true') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.byoseSrc = src;
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      document.head.appendChild(script);
    });
  }

  async function ensureVisionRuntime() {
    if (window.mobilenet && window.tf) {
      return;
    }

    await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js');
    await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js');
  }

  function loadModel() {
    if (modelPromise) {
      return modelPromise;
    }

    modelPromise = ensureVisionRuntime().then(() => {
      if (!window.mobilenet || !window.tf) {
        throw new Error('TensorFlow MobileNet is not available.');
      }
      return window.mobilenet.load(MODEL_OPTIONS);
    });
    return modelPromise;
  }

  async function classifyImage(image) {
    const model = await loadModel();
    const predictions = await model.classify(image, MAX_LABELS);

    return predictions.map((entry) => ({
      label: String(entry.className || '').split(',')[0].trim(),
      confidence: clamp(Number(entry.probability || 0), 0, 1)
    }));
  }

  async function analyzeFile(file) {
    if (!file) {
      throw new Error('No image selected.');
    }

    const [previewUrl, image] = await Promise.all([readPreview(file), fileToImage(file)]);
    const palette = extractPalette(image);

    let labels = [];
    let source = 'ai';

    try {
      labels = await classifyImage(image);
    } catch (error) {
      source = 'hybrid';
      labels = [];
    }

    const labelText = utils.normalizeText(labels.map((entry) => entry.label).join(' '));
    const objects = inferObjects(labelText, file.name);
    const patterns = inferPatterns(palette, labelText);
    const styles = inferStyles(objects, labelText, palette, patterns);
    const tokens = buildTokens(file, labels, objects, palette.colors, styles, patterns);

    return {
      fileName: file.name,
      previewUrl,
      labels,
      objects,
      colors: palette.colors,
      primaryColor: palette.primaryColor,
      styles,
      patterns,
      tokens,
      source
    };
  }

  window.ByoseImageSearch = {
    analyzeFile,
    readPreview
  };
})();