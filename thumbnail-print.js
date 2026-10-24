  async function processThumbnailForPrint(url) {
    return new Promise(resolve => {
      const image = new Image();
      image.crossOrigin = "anonymous";

      image.onload = () => {
        try {
          const width = image.naturalWidth;
          const height = image.naturalHeight;

          if (!width || !height) {
            console.error("画像サイズを取得できません:", url);
            resolve(url);
            return;
          }

          const ratio = width / height;

          // 縦長画像は加工しない
          if (ratio < 1.4) {
            resolve(url);
            return;
          }

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext("2d", {
            willReadFrequently: true
          });

          if (!ctx) {
            console.error("Canvasを利用できません:", url);
            resolve(url);
            return;
          }

          ctx.drawImage(image, 0, 0, width, height);

          const pixels = ctx.getImageData(
            0, 0, width, height
          ).data;

          function isBlackRow(y) {
            const sampleCount = 120;
            let darkCount = 0;

            for (let i = 0; i < sampleCount; i++) {
              const x = Math.floor(
                i * (width - 1) / (sampleCount - 1)
              );
              const p = (y * width + x) * 4;

              if (
                pixels[p] < 45 &&
                pixels[p + 1] < 45 &&
                pixels[p + 2] < 45
              ) {
                darkCount++;
              }
            }

            return darkCount / sampleCount >= 0.85;
          }

          let top = 0;
          let bottom = height - 1;

          // 画像の上端と下端から黒帯を検出
          while (
            top < height * 0.3 &&
            isBlackRow(top)
          ) {
            top++;
          }

          while (
            bottom > height * 0.7 &&
            isBlackRow(bottom)
          ) {
            bottom--;
          }

          let sourceX = 0;
          let sourceY = top;
          let sourceWidth = width;
          let sourceHeight = bottom - top + 1;

          if (sourceHeight <= 0) {
            console.error("画像領域を検出できません:", url);
            resolve(url);
            return;
          }

          // 黒帯除去後の画像を中央基準で16:9に切り出す
          const targetRatio = 16 / 9;
          const contentRatio = sourceWidth / sourceHeight;

          if (contentRatio > targetRatio) {
            sourceWidth = sourceHeight * targetRatio;
            sourceX = (width - sourceWidth) / 2;
          } else if (contentRatio < targetRatio) {
            const newHeight = sourceWidth / targetRatio;
            sourceY = top + (sourceHeight - newHeight) / 2;
            sourceHeight = newHeight;
          }

          const output = document.createElement("canvas");
          output.width = 1600;
          output.height = 900;

          const outputContext = output.getContext("2d");

          if (!outputContext) {
            console.error("出力画像を作成できません:", url);
            resolve(url);
            return;
          }

          outputContext.drawImage(
            image,
            sourceX,
            sourceY,
            sourceWidth,
            sourceHeight,
            0,
            0,
            1600,
            900
          );

          // 必ず16:9の画像データに変換して返す
          resolve(output.toDataURL("image/jpeg", 0.95));

        } catch (error) {
          console.error(
            "サムネイルの黒帯除去に失敗しました:",
            url,
            error
          );
          alert(
            "画像の加工に失敗しました。ブラウザのConsoleにエラーが出ていないか確認が必要です。"
          );
          resolve(url);
        }
      };

      image.onerror = () => {
        console.error("サムネイルを読み込めません:", url);
        alert(
          "サムネイルを読み込めませんでした。画像の読み込み制限が原因の可能性があります。"
        );
        resolve(url);
      };

      image.src = url;
    });
  }
