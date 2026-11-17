import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function createEars(canvas) {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff4ee, 0x635a85, 2.2));
    const light = new THREE.DirectionalLight(0xffecd8, 2.1);
    light.position.set(-2, 3, 4);
    scene.add(light);
    const camera = new THREE.OrthographicCamera(0, 1, 1, 0, .1, 2000);
    camera.position.z = 1000;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    const loader = new GLTFLoader();

    function dispose() {
        scene.traverse(object => {
            object.geometry?.dispose();
            if (object.material) {
                object.material.map?.dispose();
                object.material.dispose();
            }
        });
        renderer.dispose();
        canvas.remove();
    }

    const models = await Promise.allSettled(['izquierda', 'derecha'].map(side =>
        loader.loadAsync(new URL(`../assets/model/oreja-${side}.glb`, import.meta.url).href)
    ));
    const ears = [];
    for (const result of models) {
        if (result.status === 'rejected') continue;
        const model = result.value.scene;
        model.traverse(object => {
            if (!object.isMesh) return;
            const material = object.material;
            material.map = material.emissiveMap;
            material.emissiveMap = null;
            material.color.set(0xffffff);
            material.emissive.set(0x000000);
        });
        const bounds = new THREE.Box3().setFromObject(model);
        const center = bounds.getCenter(new THREE.Vector3());
        model.position.set(-center.x, -bounds.min.y, -center.z);
        const anchor = new THREE.Group();
        anchor.add(model);
        scene.add(anchor);
        ears.push({ anchor, modelHeight: bounds.max.y - bounds.min.y });
    }
    const failure = models.find(result => result.status === 'rejected');
    if (failure) {
        dispose();
        throw failure.reason;
    }

    let lastWidth = 0;
    let lastHeight = 0;
    let visible = false;
    return {
        draw(point, width, height, head) {
            if (width !== lastWidth || height !== lastHeight) {
                renderer.setSize(width, height, false);
                camera.right = width;
                camera.top = height;
                camera.updateProjectionMatrix();
                lastWidth = width;
                lastHeight = height;
            }
            const eyeA = point(33);
            const eyeB = point(263);
            const eyeWidth = Math.hypot(eyeA.x - eyeB.x, eyeA.y - eyeB.y);
            const roll = Math.atan2(eyeB.y - eyeA.y, eyeA.x - eyeB.x);
            const yaw = head ? -Math.atan2(head[8], head[10]) : 0;
            const pitch = head ? -Math.atan2(head[9], head[10]) : 0;
            const forehead = point(10);
            for (const [i, { anchor, modelHeight }] of ears.entries()) {
                const side = i === 0 ? 1 : -1;
                const offset = side * eyeWidth * .56;
                anchor.position.set(forehead.x + Math.cos(roll) * offset,
                    height - forehead.y + Math.sin(roll) * offset + eyeWidth * .10, 0);
                anchor.rotation.set(pitch, yaw, roll - side * .17, 'ZYX');
                const size = eyeWidth * .58 / modelHeight;
                anchor.scale.set(size, size, size * 1.65);
            }
            renderer.render(scene, camera);
            visible = true;
        },
        clear() {
            if (visible) renderer.clear();
            visible = false;
        },
        dispose,
    };
}