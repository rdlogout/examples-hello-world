// thumbnail-generator.ts
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

// FFmpeg WASM import
import { FFmpeg } from "https://esm.sh/@ffmpeg/ffmpeg@0.12.7";
import { fetchFile, toBlobURL } from "https://esm.sh/@ffmpeg/util@0.12.1";

interface ThumbnailRequest {
  file: File;
  width?: number;
  height?: number;
}

class ThumbnailGenerator {
  private ffmpeg: FFmpeg;
  private initialized = false;

  constructor() {
    this.ffmpeg = new FFmpeg();
  }

  async initialize() {
    if (this.initialized) return;

    // Load FFmpeg WASM
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.4/dist/esm";
    
    this.ffmpeg.on("log", ({ message }) => {
      console.log("FFmpeg:", message);
    });

    await this.ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });

    this.initialized = true;
    console.log("FFmpeg WASM initialized successfully");
  }

  async generateThumbnail(
    inputFile: File,
    width: number = 180,
    height: number = 180
  ): Promise<Uint8Array> {
    await this.initialize();

    const inputName = `input.${this.getFileExtension(inputFile.name)}`;
    const outputName = "thumbnail.jpg";

    // Write input file to FFmpeg's virtual file system
    await this.ffmpeg.writeFile(inputName, await fetchFile(inputFile));

    // Determine if input is video or image and use appropriate FFmpeg command
    const isVideo = this.isVideoFile(inputFile.type);
    
    if (isVideo) {
      // For video files, extract frame at 1 second and resize
      await this.ffmpeg.exec([
        "-i", inputName,
        "-ss", "1",
        "-vframes", "1",
        "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
        "-f", "mjpeg",
        "-q:v", "2",
        outputName
      ]);
    } else {
      // For image files, just resize
      await this.ffmpeg.exec([
        "-i", inputName,
        "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
        "-f", "mjpeg",
        "-q:v", "2",
        outputName
      ]);
    }

    // Read the output file
    const data = await this.ffmpeg.readFile(outputName);
    
    // Clean up
    await this.ffmpeg.deleteFile(inputName);
    await this.ffmpeg.deleteFile(outputName);

    return data as Uint8Array;
  }

  private getFileExtension(filename: string): string {
    return filename.split('.').pop()?.toLowerCase() || 'bin';
  }

  private isVideoFile(mimeType: string): boolean {
    return mimeType.startsWith('video/');
  }
}

// Initialize the thumbnail generator
const thumbnailGenerator = new ThumbnailGenerator();

async function handleRequest(request: Request): Promise<Response> {
  // Handle CORS preflight requests
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const width = parseInt(formData.get("width") as string) || 180;
    const height = parseInt(formData.get("height") as string) || 180;

    if (!file) {
      return new Response(
        JSON.stringify({ error: "No file provided" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Validate file type
    const supportedTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv', 'video/webm'
    ];

    if (!supportedTypes.includes(file.type)) {
      return new Response(
        JSON.stringify({ 
          error: "Unsupported file type", 
          supportedTypes 
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    console.log(`Processing ${file.type} file: ${file.name}`);
    console.log(`Generating thumbnail with dimensions: ${width}x${height}`);

    // Generate thumbnail
    const thumbnailData = await thumbnailGenerator.generateThumbnail(
      file,
      width,
      height
    );

    // Return the thumbnail as a JPEG image
    return new Response(thumbnailData, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Access-Control-Allow-Origin": "*",
        "Content-Disposition": `attachment; filename="thumbnail_${width}x${height}.jpg"`,
      },
    });

  } catch (error) {
    console.error("Error generating thumbnail:", error);
    return new Response(
      JSON.stringify({ 
        error: "Failed to generate thumbnail",
        details: error.message 
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}

// Start the server
const port = 8000;
console.log(`🎬 Thumbnail generator server running on http://localhost:${port}`);
console.log(`📝 Usage: POST multipart/form-data with 'file' field to generate thumbnail`);
console.log(`📐 Optional: include 'width' and 'height' fields (default: 180x180)`);

await serve(handleRequest, { port });
