import { inflateRawSync } from "node:zlib";

export const SPREADSHEET_MAX_ARCHIVE_ENTRIES = 512;
const SPREADSHEET_MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const SPREADSHEET_MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const SPREADSHEET_MAX_COMPRESSION_RATIO = 100;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_ENTRY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;

function findZipEndOfCentralDirectory(buffer: Buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }

  return -1;
}

export function validateXlsxArchiveBudget(buffer: Buffer) {
  const endOffset = findZipEndOfCentralDirectory(buffer);
  if (endOffset < 0) {
    throw new Error("Archive XLSX invalide ou répertoire central introuvable.");
  }

  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const directorySize = buffer.readUInt32LE(endOffset + 12);
  const directoryOffset = buffer.readUInt32LE(endOffset + 16);
  if (
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    throw new Error("Les archives XLSX ZIP64 ne sont pas prises en charge.");
  }
  if (entryCount > SPREADSHEET_MAX_ARCHIVE_ENTRIES) {
    throw new Error(
      `Le classeur depasse ${SPREADSHEET_MAX_ARCHIVE_ENTRIES} entrées archivées.`
    );
  }
  if (directoryOffset + directorySize > buffer.length) {
    throw new Error("Répertoire central XLSX invalide.");
  }

  let cursor = directoryOffset;
  let totalExpandedBytes = 0;

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (
      cursor + 46 > directoryOffset + directorySize ||
      buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_DIRECTORY_ENTRY_SIGNATURE
    ) {
      throw new Error("Entrée du répertoire central XLSX invalide.");
    }

    const flags = buffer.readUInt16LE(cursor + 8);
    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const declaredExpandedSize = buffer.readUInt32LE(cursor + 24);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);

    if (
      compressedSize === 0xffffffff ||
      declaredExpandedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new Error("Les entrées XLSX ZIP64 ne sont pas prises en charge.");
    }
    if ((flags & 0x1) !== 0) {
      throw new Error("Les classeurs XLSX chiffrés ne sont pas pris en charge.");
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new Error("Méthode de compression XLSX non prise en charge.");
    }
    if (declaredExpandedSize > SPREADSHEET_MAX_ENTRY_BYTES) {
      throw new Error("Une entrée du classeur depasse la taille autorisee.");
    }
    if (
      declaredExpandedSize > 0 &&
      declaredExpandedSize / Math.max(1, compressedSize) >
        SPREADSHEET_MAX_COMPRESSION_RATIO
    ) {
      throw new Error("Le ratio de decompression du classeur depasse la limite autorisee.");
    }
    if (
      localHeaderOffset + 30 > buffer.length ||
      buffer.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE
    ) {
      throw new Error("Entrée locale XLSX invalide.");
    }

    const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const compressedDataOffset =
      localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressedDataEnd = compressedDataOffset + compressedSize;
    if (compressedDataEnd > buffer.length) {
      throw new Error("Données compressées XLSX tronquées.");
    }

    const remainingBudget = SPREADSHEET_MAX_EXPANDED_BYTES - totalExpandedBytes;
    if (remainingBudget <= 0) {
      throw new Error("Le classeur depasse la taille decompressee autorisee.");
    }

    const compressedData = buffer.subarray(compressedDataOffset, compressedDataEnd);
    let actualExpandedSize: number;
    if (compressionMethod === 0) {
      actualExpandedSize = compressedData.byteLength;
    } else {
      try {
        actualExpandedSize = inflateRawSync(compressedData, {
          maxOutputLength: Math.min(remainingBudget, SPREADSHEET_MAX_ENTRY_BYTES),
        }).byteLength;
      } catch {
        throw new Error("Une entrée XLSX depasse le budget de decompression.");
      }
    }

    if (actualExpandedSize !== declaredExpandedSize) {
      throw new Error("Taille decompressee XLSX incoherente.");
    }
    totalExpandedBytes += actualExpandedSize;
    if (totalExpandedBytes > SPREADSHEET_MAX_EXPANDED_BYTES) {
      throw new Error("Le classeur depasse la taille decompressee autorisee.");
    }

    cursor += 46 + fileNameLength + extraLength + commentLength;
  }

  if (cursor !== directoryOffset + directorySize) {
    throw new Error("Taille du répertoire central XLSX incoherente.");
  }
}
