import path from "node:path";
import { google } from "googleapis";
import { CancelTuningJobResponse, GoogleGenAI } from "@google/genai";

import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import 'dotenv/config';
import  potrace from "potrace";
const ratioQuality=110;
const maxIterationAI=1;

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
You are a Senior Architectural Drafter and QA Specialist. Your task is to strictly evaluate the **graphical representation and drafting quality** of a processed floor plan attached.

**Your Focus:** You are grading the sketch/scan comparing to a professional CAD drawing. You are NOT grading the architectural design itself.

### INPUT DATA
I will give an image to work on.

### STRICT NEGATIVE CONSTRAINTS (CRITICAL)
- **NO Structural Advice:** Do not suggest adding windows, doors, or walls.
- **NO Design Critique:** Do not comment on room layout, flow, lighting, or building code compliance.
- **NO Layout Modification:** Do not request moving walls or changing dimensions.
- **Graphical Only:** If a room has no windows in the image is correct if it also has no windows.

### DETAILED SCORING ALGORITHM (0-100)
To ensure consistency, apply the following strict deduction logic. Start at 100 and deduct based on the severity of graphical errors.

**TIER 1: PROFESSIONAL CAD (Score 90-100)**
* **Condition:** Lines are perfectly straight (vector-sharp), corners are 90° (where applicable), and line weights clearly distinguish walls from furniture.
* **Allowed Defects:** None. Zero hallucinations.
* **Symbolism:** All doors/windows from input are converted to perfect standard CAD symbols.

**TIER 2: USABLE DRAFT (Score 75-89)**
* **Condition:** Structurally accurate but lacks "polish".
* **Penalty Triggers (-5 to -15 pts):**
    * *Minor Jitter:* Lines are mostly straight but have slight "hand-drawn" wobble.
    * *Inconsistent Weights:* Walls and furniture have similar line thickness.
    * *Symbol Issues:* A door swing is present but drawn clumsily (e.g., simple arc instead of a block).

**TIER 3: NEEDS CLEANUP (Score 50-74)**
* **Condition:** The geometry is correct, but the graphical quality is poor.
* **Penalty Triggers (Max Score is 74 if ANY of these exist):**
    * *Wavy Lines:* Walls look like a raster trace rather than straight vector lines.
    * *Gaping:* Doors/Windows are shown as simple holes/gaps in the wall without symbols.
    * *Noise:* Visible specks or digital artifacts in empty spaces.

**TIER 4: REJECT / FAIL (Score 0-49)**
* **Condition:** The drawing is unusable or misleading.
* **Fatal Triggers (Max Score is 49 if ANY of these exist):**
    * *Hallucination:* The model invented a room, furniture, or wall not in the input.
    * *Omission:* A wall or major element from the input is missing.
    * *Geometric Distortion:* Walls are slanted/crooked where they should be straight.
    * *Unintelligible:* Resolution is too low to read.

### SCORING TIE-BREAKER
If the output falls between two tiers (e.g., looks like Tier 2 but has one Tier 3 defect), **always assign the score from the lower tier.**

### OUTPUT FORMAT
Return strictly a single JSON object.
MANDATORY : Return a perfect formatted JSON object, WITHOUT \`\`\`json AND ANY other things like \n \d 

{
    "quality": 0, // Integer based on the Algorithm above.
    "detected_tier": "Tier X", // String: "Tier 1", "Tier 2", "Tier 3", or "Tier 4"
    "ameliorations": [
        // List specific graphical defects that justified the score deduction.
        // Format: "[Location/Element]: [Specific Graphical Defect]"
        // Example: "Living Room: Wall lines are wavy/jittery, indicating poor vectorization."
        // Example: "Entrance: Door symbol is missing, represented only as a gap."
    ]
}`,
    };
    return promptAgent2;
  }

  async ponderatePlan(base64image, aiClient, startIteration=0, originalData, originalFile) {
    this.generationConfig.systemInstruction={
      parts: [this.getSystemPromptAgent2()]
    };

    console.log(this.generationConfig);
    const req = {
      model: this.modelAgent2,
      contents: [{
        parts: [
          { inlineData: {
            mimeType: 'image/png',
            data: base64image
          }}
        ]
      }],
      config: this.generationConfig
    };


    const respAI = await aiClient.models.generateContent(req);
    try {
        if(respAI.candidates && respAI.candidates[0]) {
            const contentResponseInline = respAI.candidates[0].content.parts[0];
            console.log('Content response parts of the Agent 2:', contentResponseInline);
            console.log('Ratio needed', ratioQuality);
            console.log('Max iterations AI', maxIterationAI);
            let clearedJSON=contentResponseInline.text;
            // Supprimer les marqueurs markdown (```json au début et ``` à la fin)
            clearedJSON=clearedJSON.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            const parsedReponse=JSON.parse(clearedJSON);
            console.log('JSON final', parsedReponse);

            if(parseInt(parsedReponse.quality)<ratioQuality) {
              // Our recursive processing system
              for(let i=0;i<maxIterationAI;i++) {
                // Recall Agent 1
                const b64Image = await this.generateContent(originalData, aiClient, parsedReponse.ameliorations.join('|'));
                if(b64Image && b64Image.b64 && b64Image.mimeType) {
                    // Extraire le nom de fichier sans extension
                    const filenameWithoutExt = path.parse(originalFile.name).name;
                    await saveBase64ToFile(b64Image.mimeType, b64Image.b64, `processed_${filenameWithoutExt}_iteration_${i}_quality_${parseInt(parsedReponse.quality)}`);
                }
              }
            }

        } else {
            console.error('Aucun candidat dans la réponse');
            return false;
        }
    } catch(e) {
        console.error('Error during pondering the image', e);
        return false;
    }

  }

  async generateContent(base64image, aiClient, recommandations=false) {
    let recommandationsPrompted=(recommandations) ? `Here is some attention points to respect for the following plan: ${recommandations}` : '';
    this.generationConfig.imageConfig = {
      imageSize: "4K"
    };
    const req = {
      model: this.modelAgent1,
      contents: [{
        parts: [
          { inlineData: {
            mimeType: 'image/png',
            data: base64image
          }},
          { text: recommandationsPrompted || '' }
        ]
      }],
      config: this.generationConfig
    };

    const respAI = await aiClient.models.generateContent(req);
    try {
        if(respAI.candidates && respAI.candidates[0]) {
            const contentResponseInline = respAI.candidates[0].content.parts;
            
            if (contentResponseInline && contentResponseInline[0] && contentResponseInline[0].inlineData) {
                const inlineData = contentResponseInline[0].inlineData;
                const mimeType = inlineData.mimeType;
                const base64Data = inlineData.data;
                
                if (!mimeType || !base64Data) {
                    console.error('MimeType ou data manquant dans la réponse');
                    return false;
                }
                
                
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

const vectorizePlan=(planPath, originalFileName) => {
  console.log('--- Vectorizing with Po the plan', planPath);
  console.log(potrace);
  var params = {
    background: 'white',
    color: 'black'
  };
  potrace.trace(planPath, params, function(err, svg) {
    if (err) throw err;
    writeFile(originalFileName.split('.')[0] + '.svg', svg);
  });
}

const main = async () => {
  vectorizePlan(path.join(process.cwd(), 'processed_plan_3_2K.jpg'), 'processed_plan_3_2K.jpg');
  vectorizePlan(path.join(process.cwd(), 'processed_plan_3_4K.jpg'), 'processed_plan_3_4K.jpg');

  return;
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

            // IGNORE Ponderate at this time
            // const returnAgentPonderation = await helperAI.ponderatePlan(b64Image.base64, AIClient, b64file.base64, file);
            // console.log(returnAgentPonderation);



        } else {
            console.error('Erreur: réponse invalide de generateContent pour', file.name);
        }
    }
    
  });
  

};

main();
