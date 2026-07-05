// Ported from the SeedWords* ipcMain.handle handlers in the desktop src/index.js.
import seedwords from "seed-words";

export default {
  async SeedWordsInitialize() {
    return await seedwords.initialize();
  },

  async SeedWordsGetAllWords() {
    return seedwords.getAllSeedWords();
  },

  async SeedWordsGetWordList(data) {
    return seedwords.getWordListFromSeedArray(data);
  },

  async SeedWordsGetSeedArray(data) {
    return seedwords.getSeedArrayFromWordList(data);
  },

  async SeedWordsDoesWordExist(data) {
    return seedwords.doesSeedWordExist(data);
  },
};
