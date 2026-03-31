// Wrapping the whole extension in a JS function 
// (ensures all global variables set in this extension cannot be referenced outside its scope)
(async function (codioIDE, window) {
  const SOURCE_LANGUAGE = "English";
  const TARGET_LANGUAGE = "German";
  const TARGET_LANGUAGE_LABEL = "Deutsch";

  const BUTTON_ID = "translateGuidesToGermanButton";
  const BUTTON_LABEL = "Translate this assignment into German";
  const CHAPTER_TITLE = "Deutsch";
  const TRANSLATED_PAGE_PREFIX = "[DE] ";

  // Only create translated sidecar files for clearly text-based files.
  // Leaving executable/source files alone avoids breaking activities.
  const TRANSLATABLE_TEXT_FILE_EXTENSIONS = new Set([
    ".md",
    ".markdown",
    ".txt"
  ]);

  const systemPrompt = `
You are a precise localization assistant for Codio course content.
Translate learner-facing English text into natural German.
Preserve anything that must remain machine-usable or executable.
Do not add explanations, commentary, or extra content.
Return only the requested XML tag contents.
  `.trim();

  codioIDE.coachBot.register(BUTTON_ID, BUTTON_LABEL, onButtonPress);

  async function onButtonPress() {
    try {
      codioIDE.coachBot.write("Collecting Guides pages for German translation...");

      // Pull the structure BEFORE adding a new chapter so we do not re-process
      // any translated content created during this run.
      const structure = await window.codioIDE.guides.structure.getStructure();
      const pages = findPages(structure).filter((page) => !isTranslatedTitle(page.title));

      if (!pages.length) {
        codioIDE.coachBot.write("No untranslated Guides pages were found.");
        return;
      }

      const chapterResult = await window.codioIDE.guides.structure.add({
        title: CHAPTER_TITLE,
        type: window.codioIDE.guides.structure.ITEM_TYPES.CHAPTER
      });

      codioIDE.coachBot.write(`Created "${CHAPTER_TITLE}" chapter in Guides.`);

      for (let index = 0; index < pages.length; index++) {
        const page = pages[index];
        const pageData = await codioIDE.guides.structure.get(page.id);
        const settings = pageData?.settings || {};
        const originalTitle = page.title || `Page ${index + 1}`;
        const originalContent = settings.content || "";
        const originalActions = Array.isArray(settings.actions) ? [...settings.actions] : [];

        codioIDE.coachBot.write(
          `Translating "${originalTitle}" (${index + 1}/${pages.length})...`
        );

        const translatedTitle = await translatePageTitle(originalTitle);
        const translatedContent = await translateGuideContent(originalContent, originalTitle);
        const translatedActions = await maybeTranslateOpenTextFile(originalActions);

        await window.codioIDE.guides.structure.add(
          {
            type: window.codioIDE.guides.structure.ITEM_TYPES.PAGE,
            title: `${TRANSLATED_PAGE_PREFIX}${translatedTitle}`,
            content: translatedContent,
            layout: settings.layout,
            closeTerminalSession: settings.closeTerminalSession,
            closeAllTabs: settings.closeAllTabs,
            showFileTree: settings.showFileTree,
            actions: translatedActions
          },
          chapterResult.id,
          index + 1
        );

        codioIDE.coachBot.write(`Finished "${originalTitle}".`);
      }

      codioIDE.coachBot.write("German translation complete.");
    } catch (error) {
      console.error(error);
      codioIDE.coachBot.write(`Translation failed: ${error.message || error}`);
    } finally {
      codioIDE.coachBot.showMenu();
    }
  }

  function findPages(node) {
    if (!node || typeof node !== "object") {
      return [];
    }

    const pages = [];
    if (node.type === "page") {
      pages.push(node);
    }

    for (const value of Object.values(node)) {
      pages.push(...findPages(value));
    }

    return pages;
  }

  function isTranslatedTitle(title) {
    return typeof title === "string" && title.trim().startsWith(TRANSLATED_PAGE_PREFIX);
  }

  async function translatePageTitle(title) {
    const prompt = `
Translate this Codio Guides page title from ${SOURCE_LANGUAGE} to ${TARGET_LANGUAGE}.

Rules:
1. Translate naturally into German.
2. Do not add quotation marks.
3. Do not add a prefix like [DE]; that is handled separately.
4. Return only the translated title inside <translated_title> tags.

<original_title>
${title}
</original_title>

<translated_title>
    `.trim();

    const translated = await askAndExtractXmlTag(prompt, "translated_title");
    return translated || title;
  }

  async function translateGuideContent(content, pageTitle) {
    if (!content || !content.trim()) {
      return content;
    }

    const prompt = `
Translate the following Codio Guides page from ${SOURCE_LANGUAGE} to ${TARGET_LANGUAGE}.

Page title:
${pageTitle}

Rules:
1. Translate all learner-facing prose into German.
2. Preserve Markdown structure exactly.
3. Preserve HTML structure and attributes exactly.
4. Preserve URLs, image paths, file paths, placeholders, variables, macros, and template syntax exactly.
5. Preserve fenced code blocks, inline code, commands, package names, API names, filenames, and source code exactly.
6. Translate visible link text, headings, paragraphs, bullet text, table text, and callout text where safe.
7. Do not add explanations, notes, or extra content.
8. Return only the translated page inside <translated_content> tags.

<original_content>
${content}
</original_content>

<translated_content>
    `.trim();

    const translated = await askAndExtractXmlTag(prompt, "translated_content");
    return translated || content;
  }

  async function maybeTranslateOpenTextFile(actions) {
    const fileActionIndex = actions.findIndex(
      (action) =>
        action &&
        action.type === "file" &&
        typeof action.fileName === "string" &&
        action.fileName.trim() !== ""
    );

    if (fileActionIndex === -1) {
      return actions;
    }

    const sourcePath = actions[fileActionIndex].fileName;

    if (!isTranslatableTextFile(sourcePath)) {
      return actions;
    }

    try {
      const sourceContent = await codioIDE.files.getContent(sourcePath);
      const translatedContent = await translateTextFile(sourceContent, sourcePath);
      const translatedPath = buildTranslatedFilePath(sourcePath);

      try {
        await codioIDE.files.add(translatedPath, translatedContent);
      } catch (addError) {
        // If the file already exists, keep going and just point the page action at it.
        console.warn(`Could not create translated file at ${translatedPath}:`, addError);
      }

      const updatedActions = [...actions];
      updatedActions[fileActionIndex] = {
        ...updatedActions[fileActionIndex],
        fileName: translatedPath
      };

      return updatedActions;
    } catch (fileError) {
      console.warn(`Could not translate open text file "${sourcePath}":`, fileError);
      return actions;
    }
  }

  async function translateTextFile(content, filePath) {
    if (!content || !content.trim()) {
      return content;
    }

    const prompt = `
Translate this text-based file from ${SOURCE_LANGUAGE} to ${TARGET_LANGUAGE}.

File path:
${filePath}

Rules:
1. Translate learner-facing text into German.
2. Preserve Markdown structure exactly.
3. Preserve fenced code blocks, inline code, commands, URLs, placeholders, variables, and filenames exactly.
4. Do not add explanations, notes, or extra content.
5. Return only the translated file contents inside <translated_file> tags.

<original_file>
${content}
</original_file>

<translated_file>
    `.trim();

    const translated = await askAndExtractXmlTag(prompt, "translated_file");
    return translated || content;
  }

  async function askAndExtractXmlTag(userPrompt, xmlTag) {
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

    const raw = result?.result || "";
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

  function isTranslatableTextFile(filePath) {
    const extension = getFileExtension(filePath);
    return TRANSLATABLE_TEXT_FILE_EXTENSIONS.has(extension);
  }

  function getFileExtension(filePath) {
    const fileName = filePath.split("/").pop() || "";
    const lastDot = fileName.lastIndexOf(".");
    if (lastDot === -1) {
      return "";
    }
    return fileName.slice(lastDot).toLowerCase();
  }

  function buildTranslatedFilePath(filePath) {
    const lastSlash = filePath.lastIndexOf("/");
    const directory = lastSlash === -1 ? "" : filePath.slice(0, lastSlash + 1);
    const fileName = lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);

    if (fileName.includes(".de.")) {
      return filePath;
    }

    const lastDot = fileName.lastIndexOf(".");
    if (lastDot === -1) {
      return `${directory}${fileName}.de`;
    }

    const baseName = fileName.slice(0, lastDot);
    const extension = fileName.slice(lastDot);
    return `${directory}${baseName}.de${extension}`;
  }
})(window.codioIDE, window);
