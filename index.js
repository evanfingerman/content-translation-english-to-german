(async function (codioIDE, window) {
  const BUTTON_ID = "translateGuidesInPlaceGerman";
  const BUTTON_LABEL = "Translate English to German";
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
      codioIDE.coachBot.write("Scanning .guides files...");

      const {
        contentJsonPaths,
        contentMarkdownPaths,
        assessmentJsonPaths
      } = await discoverGuidesPaths();

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

  async function discoverGuidesPaths() {
    const contentJsonPaths = [];
    const contentMarkdownPaths = [];
    const assessmentJsonPathSet = new Set();
  
    await collectContentNode(
      `${ROOT_GUIDES_PATH}/content`,
      contentJsonPaths,
      contentMarkdownPaths,
      assessmentJsonPathSet
    );
  
    return {
      contentJsonPaths: contentJsonPaths.sort(),
      contentMarkdownPaths: contentMarkdownPaths.sort(),
      assessmentJsonPaths: Array.from(assessmentJsonPathSet).sort()
    };
  }
  
  async function collectContentNode(
    folderPath,
    contentJsonPaths,
    contentMarkdownPaths,
    assessmentJsonPathSet
  ) {
    const indexPath = `${folderPath}/index.json`;
    const indexRaw = await readFile(indexPath);
    const indexData = JSON.parse(indexRaw);
  
    contentJsonPaths.push(indexPath);
  
    const order = Array.isArray(indexData.order) ? indexData.order : [];
  
    for (const slug of order) {
      const pageJsonPath = `${folderPath}/${slug}.json`;
  
      if (await fileExists(pageJsonPath)) {
        contentJsonPaths.push(pageJsonPath);
  
        const pageMdPath = `${folderPath}/${slug}.md`;
        if (await fileExists(pageMdPath)) {
          contentMarkdownPaths.push(pageMdPath);
  
          const markdown = await readFile(pageMdPath);
          for (const taskId of extractAssessmentTaskIds(markdown)) {
            assessmentJsonPathSet.add(`${ROOT_GUIDES_PATH}/assessments/${taskId}.json`);
          }
        }
  
        continue;
      }
  
      await collectContentNode(
        `${folderPath}/${slug}`,
        contentJsonPaths,
        contentMarkdownPaths,
        assessmentJsonPathSet
      );
    }
  }
  
  async function fileExists(path) {
    try {
      await readFile(path);
      return true;
    } catch (error) {
      return false;
    }
  }
  
  function extractAssessmentTaskIds(markdown) {
    const ids = new Set();
    const regex = /\{[^{}]+\|assessment\}\(([^)]+)\)/g;
  
    let match;
    while ((match = regex.exec(markdown)) !== null) {
      ids.add(match[1].trim());
    }
  
    return Array.from(ids);
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
          if (shouldTranslateAssessmentString(nextPath, value)) {
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
  
    const api =
      (codioIDE && codioIDE.remoteCommand) ||
      (window.codioIDE && window.codioIDE.remoteCommand);
  
    if (!api || typeof api.run !== "function") {
      throw new Error(`No supported write API was found for ${path}.`);
    }
  
    const base64Content = toBase64Utf8(content);
    const escapedPath = shellQuote(path);
  
    const command = [
      "bash",
      "-lc",
      `mkdir -p "$(dirname ${escapedPath})" && printf '%s' '${base64Content}' | base64 -d > ${escapedPath}`
    ];
  
    await api.run(command);
  }
  
  function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
  }
  
  function toBase64Utf8(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }
})(window.codioIDE, window);
