// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');

const path = require('path');
const fs = require('fs');

const mapping = {
	"csSession": "crshSession"
}

function extractFromDefSource(source) {
    // Remove leading whitespaces, spaces, and tabs
    source = source.replace(/^\s+|\s+$/g, '');
    
    // Extract function/method name and parameters
    const defMatch = source.match(/^(def|class)\s+(\w+)\((.*)\)/);
    if (!defMatch) return { __source__: source }; // No valid function or class definition found
  
    const [, type, name, paramsStr] = defMatch;
    const params = paramsStr.split(/\s*,\s*/);
  
    // Extract description
    let description = null;
    const descriptionMatch = source.match(/['"]{3}([\s\S]*?)['"]{3}/);
    if (descriptionMatch) {
        description = descriptionMatch[1];
    }
  
    // Construct object with source, parameters, and description
    const result = {
        __source__: source,
        __name__: name,
        __type__: type === "def" ? "func" : type,
        __description__: description ? description : "",
    };
  
    result.__parameters__ = params.filter(param => param.trim() !== '').map(param => {
        let [paramName, defaultValue] = param.split('=').map(part => part.trim());
        let typeHint = null;
      
        // Extracting type hint if present
        const typeHintMatch = paramName.match(/^(.*?):\s*(.*)$/);
        if (typeHintMatch) {
            paramName = typeHintMatch[1].trim();
            typeHint = typeHintMatch[2].trim();
        }

        // Return parameter object
        return {
            name: paramName,
            typeHint: typeHint || null,
            defaultValue: defaultValue || null
        };
    });
  
    return result;
}
  
function parsePythonSource(source) {
	const lines = source.split('\n');
	const result = {};
	const indentation = /^\s*/;
	let currentClass = null;
	let currentFunc = null;
	let currentIndentLevel = null;
  
	function getCodeBlock(startIndex) {
	    const blockLines = [];
	    const initialIndent = lines[startIndex].match(indentation)[0].length;
  
	    for (let i = startIndex; i < lines.length; i++) {
			const currentIndent = lines[i].match(indentation)[0].length;
  
			if (i > startIndex && currentIndent <= initialIndent && lines[i].trim()) {
				break;
			}
  
			blockLines.push(lines[i]);
	  	}
  
	  	return blockLines.join('\n');
	}
  
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const classMatch = line.match(/^class\s+(\w+)/);
		const funcMatch = line.match(/^def\s+(\w+)/);
		const methodMatch = line.match(/^\s+def\s+(\w+)/);
  
		if (classMatch) {
			currentClass = classMatch[1];
			currentIndentLevel = line.match(indentation)[0].length;
			result[currentClass] = extractFromDefSource(getCodeBlock(i));
			currentFunc = null;
		} else if (funcMatch) {
			currentIndentLevel = line.match(indentation)[0].length;
			if (currentClass) {
				currentFunc = funcMatch[1];
				result[currentClass][currentFunc] = extractFromDefSource(getCodeBlock(i));
			} else {
				result[funcMatch[1]] = extractFromDefSource(getCodeBlock(i));
				currentFunc = null;
			}
		} else if (methodMatch && currentClass) {
			currentFunc = methodMatch[1];
			result[currentClass][currentFunc] = extractFromDefSource(getCodeBlock(i));
		}
	}
  
	return result;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "crshmodulo-helper-v1" is now active!');

	const activeEditor = vscode.window.activeTextEditor;

	// Define file information
	let fileName;
	let filePath;
	let languageId;
	let currentDir;
	let foundCslibPath;
	let foundCslibMainPath;
	let cslibMainParsedSource = {};
	let content;

	if (activeEditor) {
		// Get file information
		fileName = activeEditor.document.fileName;
		filePath = activeEditor.document.uri.fsPath;
		languageId = activeEditor.document.languageId;

		// Check for cslib
		currentDir = path.dirname(activeEditor.document.uri.fsPath);
		while (true) {
			const possibleCslibPath = path.join(currentDir, "cslib");

			if (fs.existsSync(possibleCslibPath) && fs.statSync(possibleCslibPath).isDirectory()) {
				foundCslibPath = possibleCslibPath;
				break;
			}

			const parentDir = path.dirname(currentDir);
			if (parentDir === currentDir) {
				// Reached the root of the file system
				break;
			}
			currentDir = parentDir;
		};

		// Check for cslib/main.py
		if (foundCslibPath) {
			const possibleCslibMainPath = path.join(foundCslibPath, "main.py");
			if (fs.existsSync(possibleCslibMainPath)) {
				foundCslibMainPath = possibleCslibMainPath;
			}
		}

		// Read main.py file and parse it
		if (foundCslibMainPath) {
			const mainContent = fs.readFileSync(foundCslibMainPath, 'utf-8');
			if (mainContent) {
				cslibMainParsedSource = parsePythonSource(mainContent);
				console.log(cslibMainParsedSource);
			}
		}

		vscode.languages.registerHoverProvider("python", {

			provideHover(document, position, token) {
				// Get word information
				const range = document.getWordRangeAtPosition(position);
				const word = document.getText(range);
				const wordMapped = mapping.hasOwnProperty(word) ? mapping[word] : word;

				const beforeRange = new vscode.Range(position.line,0, position.line, range.start.character);
				const beforeWord = document.getText(beforeRange).split(/[^a-zA-Z0-9_\.]+/g).reverse()[0].replace(/\.*$/,'');
				const beforeWordMapped = mapping.hasOwnProperty(beforeWord) ? mapping[beforeWord] : beforeWord;

				// Get from parsed
				let obj;
				if (cslibMainParsedSource.hasOwnProperty(wordMapped)) {
					obj = cslibMainParsedSource[wordMapped];
				} else if (cslibMainParsedSource.hasOwnProperty(beforeWordMapped)) {
					if (wordMapped && wordMapped !== "") {
						if (cslibMainParsedSource[beforeWordMapped].hasOwnProperty(wordMapped)) {
							obj = cslibMainParsedSource[beforeWordMapped][wordMapped];
						}
					} else {
						obj = cslibMainParsedSource[beforeWordMapped];
					}
				}

				// Display
				const markdown = new vscode.MarkdownString(``, true);

				if (obj) {
					markdown.appendMarkdown(`**${obj.__name__}** (*${obj.__type__}*)\n\n`);
					if (obj.__parameters__.length > 0) {
						markdown.appendMarkdown(`### Parameters:`);
						obj.__parameters__.forEach(param => {
							let paramStr = `  ${param.name}`;
							if (param.typeHint !== null) {
								paramStr += `: ${param.typeHint}`;
							}
							if (param.defaultValue !== null) {
								paramStr += ` = ${param.defaultValue}`;
							}
							markdown.appendCodeblock(paramStr, 'python');
						});
					}
					markdown.appendMarkdown(`<span style="color:#94A;"><br>🛠️Text inserted by CrshModulo-Helper</span>`);
				}
				markdown.isTrusted = true;
				return new vscode.Hover(markdown);
			}
		
		});
	}
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
