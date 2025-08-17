let cvReady = false;
self.Module = {
    onRuntimeInitialized() {
        cvReady = true;
        postMessage({ type: 'CV_READY' });
        console.log('[detect] OpenCV ready');
    }
};
importScripts('/opencv.js');

// tl,tr,br,bl に並べ替え
function orderQuad(pts) {
    const arr = pts.slice().sort((a, b) => a.y - b.y);
    const [t1, t2, b1, b2] = [arr[0], arr[1], arr[2], arr[3]];
    const [tl, tr] = t1.x < t2.x ? [t1, t2] : [t2, t1];
    const [bl, br] = b1.x < b2.x ? [b1, b2] : [b2, b1];
    return [tl, tr, br, bl];
}

// 輪郭群から四角候補を作る（近似→凸包→再近似の順に試す）
function candidatesFromContours(contours, areaImg, scale) {
    const cands = [];
    for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const peri = cv.arcLength(c, true);
        const areaC = Math.abs(cv.contourArea(c));
        const areaRatioC = areaC / areaImg;

        // 面積が小さすぎるノイズは早期除外（0.07まで緩和）
        if (areaRatioC < 0.07) continue;

        // ① 直接近似
        let approx = new cv.Mat();
        cv.approxPolyDP(c, approx, 0.02 * peri, true);
        if (approx.rows !== 4) {
            // ② 凸包→再近似
            const hull = new cv.Mat();
            cv.convexHull(c, hull, true, true); // returnPoints = true
            approx.delete(); approx = new cv.Mat();
            const periH = cv.arcLength(hull, true);
            cv.approxPolyDP(hull, approx, 0.03 * periH, true);
            hull.delete();
        }
        if (approx.rows !== 4) { approx.delete(); continue; }

        // 凸性チェック
        if (!cv.isContourConvex(approx)) { approx.delete(); continue; }

        // 矩形度（contour面積 / 外接矩形面積）
        const rect = cv.boundingRect(approx);
        const rectArea = rect.width * rect.height;
        const rectRatio = rectArea > 0 ? (areaC / rectArea) : 0;

        // 端ベタ当たり除外（見切れ）※緩め
        const m = 2;
        const w = Math.round(Math.sqrt(areaImg)); // 近似用（使わないが一応）
        if (rect.x <= m || rect.y <= m) {/* pass */ }
        if (rectArea === 0) { approx.delete(); continue; }

        // スコア：面積重視 + 矩形度
        const score = (areaRatioC * 0.7) + (rectRatio * 0.3);

        // 4点→元解像度に戻す
        const pts = [];
        for (let j = 0; j < 4; j++) {
            const p = approx.intPtr(j, 0);
            pts.push({ x: Math.round(p[0] / scale), y: Math.round(p[1] / scale) });
        }
        cands.push({ quad: orderQuad(pts), score, areaRatio: areaRatioC, rectRatio, reason: 'approx/hull' });
        approx.delete();
    }
    return cands;
}

// 二値マスクから最大連結成分を四角化（フォールバック）
function candidateFromMask(mask, areaImg, scale) {
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let best = null;
    for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const areaC = Math.abs(cv.contourArea(c));
        const areaRatio = areaC / areaImg;
        if (areaRatio < 0.07) continue;

        // 凸包→近似で4点化
        const hull = new cv.Mat();
        cv.convexHull(c, hull, true, true);
        const peri = cv.arcLength(hull, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(hull, approx, 0.03 * peri, true);

        if (approx.rows === 4 && cv.isContourConvex(approx)) {
            const rect = cv.boundingRect(approx);
            const rectArea = rect.width * rect.height;
            const rectRatio = rectArea > 0 ? (areaC / rectArea) : 0;
            const score = (areaRatio * 0.7) + (rectRatio * 0.3);

            const pts = [];
            for (let j = 0; j < 4; j++) {
                const p = approx.intPtr(j, 0);
                pts.push({ x: Math.round(p[0] / scale), y: Math.round(p[1] / scale) });
            }
            const cand = { quad: orderQuad(pts), score, areaRatio, rectRatio, reason: 'mask' };
            if (!best || cand.score > best.score) best = cand;
        }
        hull.delete(); approx.delete();
    }
    contours.delete(); hierarchy.delete();
    return best ? [best] : [];
}

onmessage = (e) => {
    if (e.data.type !== 'FRAME' || !cvReady) return;

    const bmp = e.data.frame;
    const W = bmp.width, H = bmp.height;

    // 速度と安定性の折衷：長辺960px
    const maxSide = 960;
    const scale = Math.min(1, maxSide / Math.max(W, H));
    const w = Math.round(W * scale), h = Math.round(H * scale);

    const off = new OffscreenCanvas(w, h);
    const ictx = off.getContext('2d');
    ictx.drawImage(bmp, 0, 0, w, h);
    const imgData = ictx.getImageData(0, 0, w, h);

    const src = cv.matFromImageData(imgData);
    const gray = new cv.Mat(); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // 前処理：ヒスト均等化 + ぼかし
    const eq = new cv.Mat(); cv.equalizeHist(gray, eq);
    const blur = new cv.Mat(); cv.GaussianBlur(eq, blur, new cv.Size(5, 5), 0);

    // エッジ → 連結強化
    const edges = new cv.Mat(); cv.Canny(blur, edges, 50, 150);
    const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
    const closed = new cv.Mat();
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, k, new cv.Point(-1, -1), 1);
    cv.dilate(closed, closed, k, new cv.Point(-1, -1), 1);

    // 輪郭→四角候補
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const areaImg = w * h;
    let cands = candidatesFromContours(contours, areaImg, scale);

    // フォールバック：二値マスク（Otsu）から最大連結成分
    if (cands.length === 0) {
        const bw = new cv.Mat();
        cv.threshold(blur, bw, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
        // 背景が明るい場合は反転も試す
        const mean = cv.mean(bw)[0];
        if (mean < 127) cv.bitwise_not(bw, bw);

        const k2 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
        cv.morphologyEx(bw, bw, cv.MORPH_CLOSE, k2, new cv.Point(-1, -1), 2);
        cands = candidateFromMask(bw, areaImg, scale);

        bw.delete(); k2.delete();
    }

    // ベスト選択とデバッグ出力
    if (cands.length > 0) {
        cands.sort((a, b) => b.score - a.score);
        const best = cands[0];
        console.table(cands.slice(0, 3).map(c => ({
            reason: c.reason, areaRatio: c.areaRatio.toFixed(3),
            rectRatio: c.rectRatio.toFixed(3), score: c.score.toFixed(3)
        })));
        postMessage({ type: 'RESULT', quad: best.quad });
    } else {
        console.warn('[detect] no quad candidates after all passes');
        postMessage({ type: 'RESULT', quad: null });
    }

    // 後始末
    contours.delete(); hierarchy.delete();
    src.delete(); gray.delete(); eq.delete(); blur.delete();
    edges.delete(); closed.delete(); k.delete();
    bmp.close();
};
