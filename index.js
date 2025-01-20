const fs = require('fs');
const protobuf = require('protobufjs');
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');


// Check if the file path is provided
if (process.argv.length < 4) {
  console.error("Usage: node index.js <manifest> <'Star Rail Games' folder>");
  process.exit(1);
}

const binaryFilePath = process.argv[2];
const gameFilePath = process.argv[3];

// Array to hold paths from list.txt
let paths = [];

function checkFilenameAgainstPatterns(filename, patterns) {
    // Convert the patterns to regular expressions
    const regexPatterns = patterns.map(pattern => {
        // Escape special characters and replace '*' with '.*' for regex
        const regexString = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
        return new RegExp(`^${regexString}$`);
    });

    // Check if the filename matches any of the regex patterns
    return regexPatterns.some(regex => regex.test(filename));
}

function renameAndMoveFile(currentFilePath, newFilePath, callback) {
    // Create the new directory if it doesn't exist
    const newDirectoryPath = path.dirname(newFilePath); // Get the directory from the new file path

    fs.mkdir(newDirectoryPath, { recursive: true }, (err) => {
        if (err) {
            return callback(`Error creating directory: ${err}`);
        }

        // Rename (move) the file
        fs.rename(currentFilePath, newFilePath, (err) => {
            if (err) {
                return callback(`Error moving file: ${err}`);
            }
            callback(null, 'File renamed and moved successfully!');
        });
    });
}

function computeMD5(filePath) {
    return new Promise((resolve, reject) => {
        // Create a hash object
        const hash = crypto.createHash('md5');

        // Create a read stream for the binary file
        const readStream = fs.createReadStream(filePath);

        // Pipe the read stream to the hash object
        readStream.on('data', (data) => {
            hash.update(data); // Update hash with each chunk of data
        });

        // When the file is fully read, resolve the promise with the hash
        readStream.on('end', () => {
            const md5Hash = hash.digest('hex'); // Get the hash in hexadecimal format
            console.log(`MD5 hash: ${md5Hash}`);
            resolve(md5Hash); // Resolve with the computed hash
        });

        // Handle any errors while reading the file
        readStream.on('error', (err) => {
            console.error(`Error reading file: ${err.message}`);
            reject(err); // Reject the promise with the error
        });
    });
}

// Function to extract data from a binary file
function extractBinaryData(inputFile, offset, size, outputFile) {
    // Open the file in read mode
    const fileDescriptor = fs.openSync(inputFile, 'r');

    // Create a buffer to hold the extracted data
    const buffer = Buffer.alloc(size);

    // Read the data from the specified offset
    fs.readSync(fileDescriptor, buffer, 0, size, offset);

    // Close the file
    fs.closeSync(fileDescriptor);

    // createdir
    const dir = path.dirname(outputFile);

    // Check if the directory exists, if not create it
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    // Write the extracted data to the output file
    fs.writeFileSync(outputFile, buffer);

    console.log(`Extracted ${size} bytes from ${inputFile} starting at offset ${offset} and saved to ${outputFile}`);
}

// Load the manifest.proto definition
protobuf.load("manifest.proto")
  .then(root => {
    // Obtain the message type
    const RootMessage = root.lookupType("root");

    // Read binary file
    fs.readFile(binaryFilePath, (err, data) => {
      if (err) {
        console.error("Error reading file:", err);
        return;
      }

      try {
        // Decode binary data to Protobuf message
        const message = RootMessage.decode(data);

        // Convert to JSON
        const jsonObject = RootMessage.toObject(message, {
          longs: String, // Convert long values to strings
          enums: String, // Use string representation of enums
          bytes: String, // Convert bytes to base64 strings
          defaults: true, // Include default values
          arrays: true, // Always include empty arrays
          objects: true, // Always include empty objects
        });

        // console.log("Parsed JSON:", JSON.stringify(jsonObject, null, 2));
        fs.writeFile("manifest.json", JSON.stringify(jsonObject, null, 2), writeErr => {
            if (writeErr) {
              console.error("Error writing JSON to file:", writeErr);
            } else {
              console.log("Parsed JSON saved to manifest.json");
            }
        });
        
        // Check if "manifest" exists in jsonObject and is an array
        if (Array.isArray(jsonObject.manifests)) {
            // Filter and print elements with "fileName" in paths array
            jsonObject.manifests.forEach(manifestElement => {
              if (manifestElement.fileName && checkFilenameAgainstPatterns(manifestElement.fileName, paths)) {
                console.log("Matching element:", manifestElement);

                let outputCreated = false;

                // Check if fileData exists and has length >= 1
                if (manifestElement.fileData && manifestElement.fileData.length >= 1) {
                    manifestElement.fileData.forEach(fileData => {
                        
                        // return if found first
                        if (outputCreated) return;

                        // console.log("File Data Tag:", fileData.patchInfo);
                        if (fileData.patchInfo && fileData.patchInfo.length >= 1) {
                            fileData.patchInfo.forEach(fileDiff => {

                                // 문제가 생길 여지가 분명히 있음 patchInfo는 array로 주는데 일단 diff가 하나만 준다 가정할경우...

                                try {
                                    const files = fs.readdirSync(gameFilePath + "/ldiff/");
                                    
                                    if (files.includes(fileDiff.id)) {
                                        extractBinaryData(gameFilePath + "/ldiff/" + fileDiff.id, fileDiff.offset, fileDiff.size, './hdiff/' + manifestElement.fileName + '.hdiff');
                                        outputCreated = true;
                                        return;
                                    }

                                } catch (err) {
                                    console.error('Unable to scan directory: ' + err);
                                }
                            });
                        }
                    });
                }

                // if output.hdiff created
                if (outputCreated) {

                    // console.log(manifestElement.fileName);
                    // console.log(manifestElement.size);
                    // console.log(manifestElement.fileHash);
                    
                    // Execute the command
                    const process = spawn("./hpatchz.exe", [`${gameFilePath}/${manifestElement.fileName}`, './hdiff/' + manifestElement.fileName + '.hdiff', './hdiff/' + manifestElement.fileName, "-f"]);

                    // Handle output data
                    //process.stdout.on('data', (data) => {
                    //    console.log(`Output: ${data}`);
                    //});

                    // Handle error data
                    process.stderr.on('data', (data) => {
                        console.error(`Error output: ${data}`);
                    });

                    // Handle output data
                    process.on('exit', (code) => {
                        // console.log(`Process exited with code: ${code}`);

                        computeMD5('./hdiff/' + manifestElement.fileName)
                            .then(outputMD5 => {
                                if (outputMD5 === manifestElement.fileHash) {
                                    console.log("Good!");
                                    renameAndMoveFile('./hdiff/' + manifestElement.fileName, "./output/" + manifestElement.fileName, (err, message) => {
                                        if (err) {
                                            console.error(err);
                                        } else {
                                            console.log(message);
                                        }
                                    });

                                } else {
                                    console.log("Bad!");
                                    console.log(outputMD5, manifestElement.fileHash);
                                    
                                }
                            })
                            .catch(err => {
                                console.error("Failed to compute MD5 hash:", err);
                            });


                    });
                }
              }
            });
          } else {
            console.log("No 'manifests' array found in parsed JSON.");
          }

      } catch (decodeErr) {
        console.error("Error decoding Protobuf message:", decodeErr);
      }
      
    });
  })
  .catch(loadErr => {
    console.error("Error loading .proto file:", loadErr);
  });

  // Load list.txt file
fs.readFile('list.txt', 'utf8', (err, data) => {
    if (err) {
      console.error("Error reading list.txt:", err);
      return;
    }
  
    // Split file content by lines to get an array of paths
    paths = data.split('\n').map(line => line.trim()).filter(line => line !== '');
  
    // Print each path
    paths.forEach((path, index) => {
      console.log(`Path ${index + 1}: ${path}`);
    });
});