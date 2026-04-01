(async function (codioIDE, window) {
  const BUTTON_ID = "translateGuidesInPlaceGerman";
  const BUTTON_LABEL = "Translate this assignment into German";
  const ROOT_GUIDES_PATH = ".guides";

  const SOURCE_LANGUAGE = "English";
  const TARGET_LANGUAGE = "German";

  // Safety toggle. Set to true first if you want to verify logs before writing.
  const DRY_RUN = false;

  // Leaving this false avoids changing hidden/internal assessment names unless you decide otherwise.
  const TRANSLATE_ASSESSMENT_SOURCE_NAME = false;

  const systemPrompt = `
You are a precise localization assistant for Codio course content.
Translate learner-facing English text into natural German.
Preserve anything that is machine-usable, executable, structural, or an internal identifier.
Do not add explanations, notes, or extra content.
Return only the requested XML tag contents.
  `.trim();

  codioIDE.coachBot.register(BUTTON_ID, BUTTON_LABEL, onButtonPress);

  async function onButtonPress() {
    try {
      codioIDE.coachBot.write("NEW IN-PLACE BUILD LOADED");
      throw new Error("NEW IN-PLACE BUILD LOADED");
      
      codioIDE.coachBot.write("Scanning .guides files...");

      const allPaths = (await walk(ROOT_GUIDES_PATH)).sort();

      const contentJsonPaths = allPaths.filter(
        (path) => path.startsWith(".guides/content/") && path.endsWith(".json")
      );

      const contentMarkdownPaths = allPaths.filter(
        (path) => path.startsWith(".guides/content/") && path.endsWith(".md")
      );

      const assessmentJsonPaths = allPaths.filter(
        (path) => path.startsWith(".guides/assessments/") && path.endsWith(".json")
      );

      codioIDE.coachBot.write(
        `Found ${contentJsonPaths.length} content JSON files, ${contentMarkdownPaths.length} content markdown files, and ${assessmentJsonPaths.length} assessment JSON files.`
      );

      let changedFiles = 0;

      for (const path of contentJsonPaths) {
        const changed = await translateContentJsonFile(path);
        if (changed) changedFiles += 1;
      }

      for (const path of contentMarkdownPaths) {
        const changed = await translateMarkdownFile(path);
        if (changed) changedFiles += 1;
      }

      for (const path of assessmentJsonPaths) {
        const changed = await translateAssessmentJsonFile(path);
        if (changed) changedFiles += 1;
      }

      codioIDE.coachBot.write(
        DRY_RUN
          ? `Dry run complete. ${changedFiles} files would be updated.`
          : `Translation complete. Updated ${changedFiles} files in place.`
      );
    } catch (error) {
      console.error(error);
      codioIDE.coachBot.write(`Translation failed: ${error.message || error}`);
    } finally {
      codioIDE.coachBot.showMenu();
    }
  }

  async function translateContentJsonFile(path) {
    const raw = await readFile(path);
    const data = JSON.parse(raw);
    const original = JSON.stringify(data);

    if (typeof data.title === "string" && data.title.trim()) {
      data.title = await translateTitle(data.title, path);
    }

    if (typeof data.learningObjectives === "string" && data.learningObjectives.trim()) {
      data.learningObjectives = await translateRichText(
        data.learningObjectives,
        `learning objectives in ${path}`
      );
    }

    const updated = JSON.stringify(data);

    if (updated === original) {
      return false;
    }

    await writeJson(path, data);
    codioIDE.coachBot.write(`Updated ${path}`);
    return true;
  }

  async function translateMarkdownFile(path) {
    const original = await readFile(path);
    const translated = await translateRichText(original, `markdown file ${path}`);

    if (translated === original) {
      return false;
    }

    await writeFile(path, translated);
    codioIDE.coachBot.write(`Updated ${path}`);
    return true;
  }

  async function translateAssessmentJsonFile(path) {
    const raw = await readFile(path);
    const data = JSON.parse(raw);
    const original = JSON.stringify(data);

    await translateAssessmentNode(data, [path]);

    const updated = JSON.stringify(data);

    if (updated === original) {
      return false;
    }

    await writeJson(path, data);
    codioIDE.coachBot.write(`Updated ${path}`);
    return true;
  }

  async function translateAssessmentNode(node, pathStack) {
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index++) {
        const value = node[index];
        const nextPath = [...pathStack, String(index)];

        if (typeof value === "string") {
          if (shouldTranslateAssessmentString(nextPath)) {
            node[index] = await translateRichText(value, nextPath.join("."));
          }
        } else if (value && typeof value === "object") {
          await translateAssessmentNode(value, nextPath);
        }
      }
      return;
    }

    if (!node || typeof node !== "object") {
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      const nextPath = [...pathStack, key];

      if (typeof value === "string") {
        if (shouldTranslateAssessmentString(nextPath, value)) {
          node[key] = await translateRichText(value, nextPath.join("."));
        }
        continue;
      }

      if (value && typeof value === "object") {
        await translateAssessmentNode(value, nextPath);
      }
    }
  }

  function shouldTranslateAssessmentString(pathStack, value = "") {
    const pathText = pathStack.join(".");
    const leafKey = getLastNonNumericPathPart(pathStack);

    if (!value || !value.trim()) {
      return false;
    }

    if (pathText.includes(".metadata.")) {
      return false;
    }

    if (pathText.includes(".showGuidanceAfterResponseOption.")) {
      return false;
    }

    if (pathText.includes(".showExpectedAnswerOption.")) {
      return false;
    }

    if (pathText.includes(".options.")) {
      return false;
    }

    if (pathText.includes(".opened.")) {
      return false;
    }

    if (pathText.includes(".files.")) {
      return false;
    }

    const neverTranslateKeys = new Set([
      "id",
      "_id",
      "taskId",
      "type",
      "command",
      "preExecuteCommand",
      "path",
      "content",
      "action",
      "value"
    ]);

    if (neverTranslateKeys.has(leafKey)) {
      return false;
    }

    if (leafKey === "name" && !TRANSLATE_ASSESSMENT_SOURCE_NAME) {
      return false;
    }

    const allowedKeys = new Set([
      "title",
      "instructions",
      "guidance",
      "learningObjectives",
      "text",
      "blank",
      "answer",
      "feedback",
      "output",
      "question",
      "prompt",
      "hint",
      "description",
      "explanation",
      "name",
      "distractors",
      "placeholder",
      "label"
    ]);

    return allowedKeys.has(leafKey);
  }

  function getLastNonNumericPathPart(pathStack) {
    for (let index = pathStack.length - 1; index >= 0; index--) {
      if (!/^\d+$/.test(pathStack[index])) {
        return pathStack[index];
      }
    }
    return "";
  }

  async function translateTitle(title, contextLabel) {
    const prompt = `
Translate this visible Codio Guides title from ${SOURCE_LANGUAGE} to ${TARGET_LANGUAGE}.

Rules:
1. Translate naturally into German.
2. Do not add quotation marks.
3. Do not add commentary.
4. Return only the translated title inside <translated_title> tags.

<context>
${contextLabel}
</context>

<original_title>
${title}
</original_title>

<translated_title>
    `.trim();

    const translated = await askForXmlTag(prompt, "translated_title");
    return translated || title;
  }

  async function translateRichText(text, contextLabel) {
    if (!text || !text.trim()) {
      return text;
    }

    const frozen = freezeContent(text);

    const prompt = `
Translate the following learner-facing content from ${SOURCE_LANGUAGE} to ${TARGET_LANGUAGE}.

Rules:
1. Translate human-readable instructional text into German.
2. Preserve all placeholder tokens exactly as written, including any token that starts with __FROZEN_.
3. Preserve markdown structure.
4. Preserve HTML tags and attributes.
5. Preserve URLs, file paths, commands, filenames, IDs, and executable content.
6. Preserve anything inside fenced code blocks and inline code.
7. Preserve <<< and >>> delimiters exactly, but you may translate the human text inside them.
8. For Codio macros like {Label|assessment}(task-id) or {Label}(command), only the visible label should be translated. The macro syntax itself must remain unchanged.
9. Do not add explanations, notes, or extra text.
10. Return only the translated content inside <translated_text> tags.

<context>
${contextLabel}
</context>

<original_text>
${frozen.text}
</original_text>

<translated_text>
    `.trim();

    const translatedFrozenText = await askForXmlTag(prompt, "translated_text");
    const restored = await restoreContent(translatedFrozenText || frozen.text, frozen);

    return restored;
  }

  function freezeContent(text) {
    let working = text;

    const frozenBlocks = [];
    const markdownTargets = [];
    const codioMacros = [];

    working = working.replace(/```[\s\S]*?```/g, (match) => {
      const token = `__FROZEN_BLOCK_${frozenBlocks.length}__`;
      frozenBlocks.push({ token, value: match });
      return token;
    });

    working = working.replace(/`[^`\n]+`/g, (match) => {
      const token = `__FROZEN_INLINE_${frozenBlocks.length}__`;
      frozenBlocks.push({ token, value: match });
      return token;
    });

    working = working.replace(/(!?\[[^\]]*?\])\(([^)]+)\)/g, (match, prefix, target) => {
      const token = `__FROZEN_TARGET_${markdownTargets.length}__`;
      markdownTargets.push({ token, value: target });
      return `${prefix}(${token})`;
    });

    working = working.replace(/\{([^{}]+)\}\(([^)]+)\)/g, (match, inner, target) => {
      const token = `__FROZEN_MACRO_${codioMacros.length}__`;
      codioMacros.push({ token, inner, target });
      return token;
    });

    return {
      text: working,
      frozenBlocks,
      markdownTargets,
      codioMacros
    };
  }

  async function restoreContent(text, frozen) {
    let working = text;

    for (const macro of frozen.codioMacros) {
      const rebuilt = await rebuildCodioMacro(macro);
      working = replaceAllLiteral(working, macro.token, rebuilt);
    }

    for (const target of frozen.markdownTargets) {
      working = replaceAllLiteral(working, target.token, target.value);
    }

    for (const block of frozen.frozenBlocks) {
      working = replaceAllLiteral(working, block.token, block.value);
    }

    return working;
  }

  async function rebuildCodioMacro(macro) {
    const pipeIndex = macro.inner.indexOf("|");

    let label = macro.inner;
    let suffix = "";

    if (pipeIndex !== -1) {
      label = macro.inner.slice(0, pipeIndex);
      suffix = macro.inner.slice(pipeIndex);
    }

    const translatedLabel = shouldTranslateMacroLabel(label)
      ? await translateShortLabel(label)
      : label;

    return `{${translatedLabel}${suffix}}(${macro.target})`;
  }

  function shouldTranslateMacroLabel(label) {
    if (!label || !label.trim()) {
      return false;
    }

    return /[A-Za-z]/.test(label);
  }

  async function translateShortLabel(label) {
    const prompt = `
Translate this short visible UI label from ${SOURCE_LANGUAGE} to ${TARGET_LANGUAGE}.

Rules:
1. Translate naturally.
2. Keep it concise.
3. Return only the translated label inside <translated_label> tags.

<original_label>
${label}
</original_label>

<translated_label>
    `.trim();

    const translated = await askForXmlTag(prompt, "translated_label");
    return translated || label;
  }

  async function askForXmlTag(userPrompt, xmlTag) {
    const result = await codioIDE.coachBot.ask(
      {
        systemPrompt,
        messages: [
          {
            role: "user",
            content: userPrompt
          }
        ]
      },
      {
        stream: false,
        preventMenu: true
      }
    );

    const raw = result && typeof result.result === "string" ? result.result : "";
    return extractXmlTagContents(raw, xmlTag).trim();
  }

  function extractXmlTagContents(text, tagName) {
    const startTag = `<${tagName}>`;
    const endTag = `</${tagName}>`;

    const startIndex = text.indexOf(startTag);
    const endIndex = text.lastIndexOf(endTag);

    if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
      return text;
    }

    return text.substring(startIndex + startTag.length, endIndex);
  }

  function replaceAllLiteral(text, search, replacement) {
    return text.split(search).join(replacement);
  }

  async function walk(dirPath) {
    const entries = await listDirectory(dirPath);
    const results = [];

    for (const entry of entries) {
      const entryPath = normalizeEntryPath(dirPath, entry);
      const isDirectory = entryIsDirectory(entry);

      if (!entryPath) {
        continue;
      }

      if (isDirectory) {
        const nested = await walk(entryPath);
        results.push(...nested);
      } else {
        results.push(entryPath);
      }
    }

    return results;
  }

  function normalizeEntryPath(parentPath, entry) {
    if (!entry) {
      return "";
    }

    if (typeof entry === "string") {
      return normalizePath(entry);
    }

    if (typeof entry.path === "string" && entry.path.trim()) {
      return normalizePath(entry.path);
    }

    if (typeof entry.name === "string" && entry.name.trim()) {
      return normalizePath(`${parentPath}/${entry.name}`);
    }

    if (typeof entry.title === "string" && entry.title.trim()) {
      return normalizePath(`${parentPath}/${entry.title}`);
    }

    return "";
  }

  function entryIsDirectory(entry) {
    if (!entry || typeof entry !== "object") {
      return false;
    }

    return (
      entry.isDirectory === true ||
      entry.directory === true ||
      entry.type === "directory" ||
      entry.type === "folder"
    );
  }

  function normalizePath(path) {
    return path.replace(/\/+/g, "/").replace(/\/$/, "");
  }

  async function listDirectory(path) {
    // Keep this helper isolated because runtime naming can differ.
    if (codioIDE.files && typeof codioIDE.files.list === "function") {
      const result = await codioIDE.files.list(path);
      return normalizeDirectoryListing(result);
    }

    if (codioIDE.files && typeof codioIDE.files.getFolderContents === "function") {
      const result = await codioIDE.files.getFolderContents(path);
      return normalizeDirectoryListing(result);
    }

    if (window.codioIDE && window.codioIDE.files && typeof window.codioIDE.files.list === "function") {
      const result = await window.codioIDE.files.list(path);
      return normalizeDirectoryListing(result);
    }

    throw new Error(
      "No supported directory listing API was found. Update listDirectory() to match your Codio extension runtime."
    );
  }

  function normalizeDirectoryListing(result) {
    if (Array.isArray(result)) {
      return result;
    }

    if (result && Array.isArray(result.files)) {
      return result.files;
    }

    if (result && Array.isArray(result.children)) {
      return result.children;
    }

    return [];
  }

  async function readFile(path) {
    if (codioIDE.files && typeof codioIDE.files.getContent === "function") {
      return await codioIDE.files.getContent(path);
    }

    if (window.codioIDE && window.codioIDE.files && typeof window.codioIDE.files.getContent === "function") {
      return await window.codioIDE.files.getContent(path);
    }

    throw new Error(`No supported read API was found for ${path}.`);
  }

  async function writeFile(path, content) {
    if (DRY_RUN) {
      console.log(`[DRY RUN] Would write ${path}`);
      return;
    }

    if (codioIDE.files && typeof codioIDE.files.setContent === "function") {
      await codioIDE.files.setContent(path, content);
      return;
    }

    if (codioIDE.files && typeof codioIDE.files.write === "function") {
      await codioIDE.files.write(path, content);
      return;
    }

    if (window.codioIDE && window.codioIDE.files && typeof window.codioIDE.files.setContent === "function") {
      await window.codioIDE.files.setContent(path, content);
      return;
    }

    if (codioIDE.files && typeof codioIDE.files.add === "function") {
      try {
        await codioIDE.files.add(path, content, { overwrite: true });
        return;
      } catch (error) {
        // Fall through to the explicit error below.
      }
    }

    throw new Error(
      `No supported write API was found for ${path}. Update writeFile() to match your Codio extension runtime.`
    );
  }

  async function writeJson(path, objectValue) {
    const serialized = JSON.stringify(objectValue, null, "\t");
    await writeFile(path, serialized);
  }
})(window.codioIDE, window);
