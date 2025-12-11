import path from "node:path";
import { google } from "googleapis";
import { CancelTuningJobResponse, GoogleGenAI } from "@google/genai";
import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import 'dotenv/config';

class GoogleHelper {
  constructor() {
    console.log("--- Authentification Google");
    this.SCOPES = [
      "https://www.googleapis.com/auth/drive.metadata.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ];
    this.CREDENTIALS_PATH = path.join(
      process.cwd(),
      "g-link-projet-nc-945c214844ca.json"
    );
    this.driveInputID = "1maHCOwkx9dWws9XfpaZCZSMvCq2kMJra"; // Remplacer ici l'ID Drive Input (pas oublier de le partager au compte de service Google Cloud)
    this.driveOutputID = "1pFI7t8jJU6ziNlkWDqA4AHCq9JbpA9ga"; // Remplacer ici l'ID Drive Output (pas oublier de le partager au compte de service Google Cloud)
    this.googleDrive = false;
  }
  async authGoogleDrive() {
    const auth = new google.auth.GoogleAuth({
      keyFile: this.CREDENTIALS_PATH,
      scopes: this.SCOPES,
    });
    const authClient = await auth.getClient();
    const drive = google.drive({ version: "v3", auth: authClient });
    return drive;
  }
  async listFilesDrive(idDrive, driveClient) {
    console.log("--- Fetching all Drives from", idDrive);
    const results = await driveClient.files.list({
      pageSize: 10,
      fields: "nextPageToken, files(id, name)",
    });

    const files = results.data.files;
    if (!files || files.length === 0) {
      console.log("No files found.");
      return;
    }
    return files.map((file) => { return { id: file.id, name: file.name } });
  }
  async getFileMimeType(fileId, driveClient) {
    try {
      const file = await driveClient.files.get({
        fileId: fileId,
        fields: "mimeType",
      });
      return file.data.mimeType;
    } catch (error) {
      console.error(`Erreur lors de la récupération du mimetype pour ${fileId}:`, error);
      return null;
    }
  }
  isImageMimeType(mimeType) {
    const imageMimeTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "application/pdf",
      "image/gif",
      "image/bmp",
      "image/webp"
    ];
    return imageMimeTypes.includes(mimeType?.toLowerCase());
  }
  async getBase64FromDriveFile(fileId, driveClient) {
    try {
      const mimeType = await this.getFileMimeType(fileId, driveClient);
      
      if (!mimeType) {
        console.log(`Impossible de récupérer le mimetype pour le fichier ${fileId}`);
        return null;
      }

      if (!this.isImageMimeType(mimeType)) {
        console.log(`Le fichier ${fileId} n'est pas une image (mimetype: ${mimeType})`);
        return null;
      }

      const response = await driveClient.files.get(
        {
          fileId: fileId,
          alt: "media",
        },
        {
          responseType: "arraybuffer",
        }
      );

      const buffer = Buffer.from(response.data);
      const base64 = buffer.toString("base64");

      console.log(`Fichier ${fileId} converti en base64 (mimetype: ${mimeType})`);
      return {
        base64,
        mimeType,
        fileId,
      };
    } catch (error) {
      console.error(`Erreur lors de la récupération du fichier ${fileId}:`, error);
      return null;
    }
  }
}

class AIHelper {
  constructor() {
    console.log("--- Launching AI Helper lib");
    this.modelAgent1 = "gemini-3-pro-image-preview";
    this.modelAgent2 = "gemini-2.5-pro";
    this.generationConfig = {
      maxOutputTokens: 65535,
      temperature: 1,
      topP: 0.95,
      thinkingConfig: {
        thinkingBudget: -1,
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "OFF",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "OFF",
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "OFF",
        },
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "OFF",
        },
      ],
      tools: [{}],
      systemInstruction: {
        parts: [this.getSystemPromptAgent1()],
      },
    };
  }
  authAiClient() {
    const ai = new GoogleGenAI({
      apiKey: process.env.GOOGLE_CLOUD_API_KEY,
    });
    return ai;
  }
  getSystemPromptAgent1() {
    const promptAgent1 = {
      text: `Task: Take the provided hand-drawn architectural plan and redraw it entirely, producing a clean, precise, and professional version.
Objectives:
Reproduce all shapes, proportions, and elements as faithfully as possible.
Deliver a version that is clear, accurate, and visually consistent.
Ensure the final output meets the standards of a professional architectural drawing.
Requirements:
Strictly respect all visible walls, angles, partitions, openings, and room shapes.
Use clean, straight, uniform lines with no noise or irregularities.
Keep the layout technical and professional.
Aim for a vector-like architectural style, similar to AutoCAD or conventional technical plans.
If any areas are unclear, provide a reasonable and coherent interpretation without altering the overall design.
**Remove all un-necessary marking like texts, signs.**

MANDATORY : You have to produce a clean and professional work, NO : "Zig Zag" lines, noises.

Visual Style:
White background.
Thin, precise black linework.
Technical drawing appearance—simple, clean, and architectural.
Expected Output:
A fully redrawn version of the plan that is accurate, clean, and ready for professional use.`,
    };
    return promptAgent1;
  }

  getSystemPromptAgent2() {
    const promptAgent2 = {
      text: `### ROLE & OBJECTIVE
You are a Senior Architectural Quality Assurance Specialist. Your task is to rigorously evaluate the quality of a processed architectural floor plan (\`scanOutput\`) by comparing it against the original source scan (\`scanInput\`).

### INPUT DATA
1. **scanInput:** The raw source image/sketch.
2. **scanOutput:** The final generated architectural drawing to be graded.

### EVALUATION CRITERIA
You must analyze the \`scanOutput\` based on the following three pillars. Deduct points for any deviations from professional drafting standards.

1. **Image Integrity & Fidelity:**
   - Assess resolution, contrast, and clarity.
   - Ensure the output is free from digital artifacts, noise, or hallucinated elements not present in the input.

2. **Line Work & Precision:**
   - **Rectilinearity:** Walls should be perfectly straight and orthogonal where appropriate.
   - **Line Weight:** Verify distinction between structural elements (thick lines for cut walls) and details (thin lines for furniture/dimensions).
   - **Smoothness:** Lines must be continuous and sharp, not jagged or pixelated.

3. **Standardization of Openings (Doors & Windows):**
   - **Doors:** Must be represented by standard architectural symbols (e.g., quarter-circle swings) indicating direction and width. They must not appear as simple gaps.
   - **Windows:** Must be depicted with standard conventions (e.g., double or triple lines within the wall thickness) to denote glass and frames.

### SCORING SYSTEM (0-100)
- **90-100:** Professional grade. Ready for construction documents. Perfect symbol usage and line quality.
- **75-89:** Good draft. Minor line jitters or slight icon inconsistencies, but structurally accurate.
- **50-74:** Mediocre. Issues with wall straightness, unclear door swings, or low resolution. Needs manual cleanup.
- **0-49:** Reject. Major hallucinations, missing standardized symbols, or poor visual fidelity.

### OUTPUT FORMAT
Return strictly a single JSON object. Do not include markdown formatting, preambles, or explanations outside the JSON.

{
    "quality": 0, // Integer between 0 and 100
    "ameliorations": [
        // List specific, actionable improvements based on the criteria above.
        // Example: "Door swings in the north bedroom are missing normalized curvature.",
        // Example: "Wall line weights are inconsistent in the living room area."
    ]
}`,
    };
    return promptAgent1;
  }

  async generateContent(base64image, aiClient) {
    const req = {
      model: this.modelAgent1,
      contents: [{ inlineData: {
        mimeType: 'image/png',
        data: base64image
      } }],
      config: this.generationConfig
    };

    const respAI = await aiClient.models.generateContent(req);
    try {
        if(respAI.candidates && respAI.candidates[0]) {
            const contentResponseInline = respAI.candidates[0].content.parts;
            console.log('Content response parts:', contentResponseInline);
            
            if (contentResponseInline && contentResponseInline[0] && contentResponseInline[0].inlineData) {
                const inlineData = contentResponseInline[0].inlineData;
                const mimeType = inlineData.mimeType;
                const base64Data = inlineData.data;
                
                if (!mimeType || !base64Data) {
                    console.error('MimeType ou data manquant dans la réponse');
                    return false;
                }
                
                console.log('MimeType:', mimeType);
                console.log('Base64 data length:', base64Data.length);
                
                return { b64: base64Data, mimeType };
            } else {
                console.error('Structure de réponse invalide - inlineData manquant');
                return false;
            }
        } else {
            console.error('Aucun candidat dans la réponse');
            return false;
        }
    } catch(e) {
        console.error('Error during processing Nano Banana Image', e);
        return false;
    }

  }
}

/**
 * Fonction helper pour sauvegarder un fichier base64 avec le bon type MIME
 * @param {string} mimeType - Le type MIME du fichier (ex: 'image/png', 'image/jpeg')
 * @param {string} base64String - La chaîne base64 du fichier
 * @param {string} [filename] - Nom de fichier optionnel (sans extension). Si non fourni, génère un nom unique
 * @returns {Promise<string>} Le chemin complet du fichier sauvegardé
 */
async function saveBase64ToFile(mimeType, base64String, filename = null) {
  try {
    const mimeTypeToExtension = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
    };

    const extension = mimeTypeToExtension[mimeType?.toLowerCase()] || 'bin';
    
    if (!filename) {
      const timestamp = Date.now();
      filename = `file_${timestamp}`;
    }

    const filePath = path.join(process.cwd(), `${filename}.${extension}`);

    const buffer = Buffer.from(base64String, 'base64');

    await writeFile(filePath, buffer);

    console.log(`Fichier sauvegardé: ${filePath} (${mimeType})`);
    return filePath;
  } catch (error) {
    console.error(`Erreur lors de la sauvegarde du fichier:`, error);
    throw error;
  }
}

const main = async () => {
  const helperGoogle = new GoogleHelper();
  // Drive section
  const authGoogle = await helperGoogle.authGoogleDrive();
  const files = await helperGoogle.listFilesDrive(
    helperGoogle.driveInputID,
    authGoogle
  );
  // AI section
  const helperAI = new AIHelper();
  const AIClient=helperAI.authAiClient();
  files.forEach(async (file) => {
    console.log('Working on file', file.name);
    const b64file=await helperGoogle.getBase64FromDriveFile(file.id, authGoogle);
    if(b64file) {
        console.log('Sending B64 to Agent 1 for file', file.name);
        const b64Image = await helperAI.generateContent(b64file.base64, AIClient);
        if(b64Image && b64Image.b64 && b64Image.mimeType) {
            // Extraire le nom de fichier sans extension
            const filenameWithoutExt = path.parse(file.name).name;
            await saveBase64ToFile(b64Image.mimeType, b64Image.b64, `processed_${filenameWithoutExt}`);
        } else {
            console.error('Erreur: réponse invalide de generateContent pour', file.name);
        }
    }
    
  });
  

};

main();
