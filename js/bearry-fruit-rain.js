import { FilesetResolver, ImageSegmenter } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1';

const fruits = ['arandanos', 'fresa', 'uvas', 'frambuesa', 'frambuesa-2'];

export async function createFruitRain(video) {
    const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm'
    );
    const segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: new URL('../assets/mediapipe/selfie_segmenter.tflite', import.meta.url).href,
            delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
    });

    const rain = document.createElement('div');
    rain.className = 'fruit-rain';
    rain.hidden = true;
    rain.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 17; index++) {
        const fruit = document.createElement('img');
        fruit.alt = '';
        fruit.src = new URL(`../assets/Images/frutas/${fruits[index % fruits.length]}.png`, import.meta.url);
        fruit.style.setProperty('--lane', ((index * 37 + 7) % 96) + '%');
        fruit.style.setProperty('--size', (5 + (index * 11) % 8) + 'cqw');
        fruit.style.setProperty('--duration', (7 + (index * 7) % 9) + 's');
        fruit.style.setProperty('--delay', (-.7 - (index * .91) % 12) + 's');
        fruit.style.setProperty('--drift', ((index * 17) % 95 - 47) + 'px');
        fruit.style.setProperty('--angle', ((index * 35) % 95 - 45) + 'deg');
        fruit.style.setProperty('--rest', ((index * 27 + 6) % 87) + '%');
        rain.append(fruit);
    }

    const foreground = document.createElement('canvas');
    foreground.className = 'fruit-foreground';
    foreground.setAttribute('aria-hidden', 'true');
    const output = foreground.getContext('2d');
    const mask = document.createElement('canvas');
    const maskContext = mask.getContext('2d');
    const input = document.createElement('canvas');
    const inputContext = input.getContext('2d');
    let maskImage;
    let lastFrame = -1;
    let lastMaskTime = -Infinity;
    let lastDrawTime = -Infinity;
    let ready = false;

    function updateMask(now) {
        if (now - lastMaskTime < 90) return;
        lastMaskTime = now;
        inputContext.drawImage(video, 0, 0, input.width, input.height);
        segmenter.segmentForVideo(input, now, result => {
            const masks = result.confidenceMasks;
            const person = masks?.[1] ?? masks?.[0];
            if (!person) return;
            if (!maskImage || mask.width !== person.width || mask.height !== person.height) {
                mask.width = person.width;
                mask.height = person.height;
                maskImage = maskContext.createImageData(mask.width, mask.height);
            }
            const confidence = person.getAsFloat32Array();
            for (let index = 0; index < confidence.length; index++) {
                maskImage.data[index * 4 + 3] = (confidence[index] - .45) * (255 / .36);
            }
            maskContext.putImageData(maskImage, 0, 0);
            ready = true;
        });
    }

    return {
        mount() {
            video.after(rain, foreground);
        },
        draw(now) {
            if (!video.videoWidth || video.currentTime === lastFrame || now - lastDrawTime < 32) return;
            lastFrame = video.currentTime;
            lastDrawTime = now;
            const ratio = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
            const width = Math.round(video.videoWidth * ratio);
            const height = Math.round(video.videoHeight * ratio);
            if (foreground.width !== width || foreground.height !== height || input.width !== width || input.height !== height) {
                foreground.width = input.width = width;
                foreground.height = input.height = height;
            }
            updateMask(now);
            if (!ready) return;
            output.globalCompositeOperation = 'source-over';
            output.drawImage(video, 0, 0, width, height);
            output.globalCompositeOperation = 'destination-in';
            output.drawImage(mask, 0, 0, width, height);
            rain.hidden = false;
        },
        dispose() {
            segmenter.close();
            rain.remove();
            foreground.remove();
        },
    };
}