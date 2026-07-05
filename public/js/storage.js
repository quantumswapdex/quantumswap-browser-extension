"use strict";

const DERIVED_KEY_SALT = "derivedkeysalt"; //key for key-value of storage
const ENCRYPTED_MAIN_KEY = "encryptedmainkey"; //key for key-value of storage
const IS_EULA_ACCEPTED = "eulaaccepted"; //key for key-value of storage

async function storageGetPath() {
    let path = await LocalStorageApi.send('StorageApiGetPath', null);
    return path;
}

async function isEulaAccepted() {
    let eula = await storageGetItem(IS_EULA_ACCEPTED);
    if (eula == null) {
        return false;
    }
    if (eula == "ok") {
        return true;
    }

    return false;
}

async function storeEulaAccepted() {
    let result = await storageSetItem(IS_EULA_ACCEPTED, "ok");
    if (result != true) {
        throw new Error('storeEulaAccepted storageSetItem IS_EULA_ACCEPTED failed.');
    }
}

async function isMainKeyCreated() {
    let salt = await storageGetItem(DERIVED_KEY_SALT);
    if (salt == null) {
        return false;
    }

    let encryptedMainKeyJson = await storageGetItem(ENCRYPTED_MAIN_KEY);
    if (encryptedMainKeyJson == null) {
        return false;
    }

    return true;
}

async function storageDecryptMainKey(passphrase) {
    let salt = await storageGetItem(DERIVED_KEY_SALT);
    if (salt == null) {
        throw new Error('storageDecryptMainKey DERIVED_KEY_SALT does not exist.');
    }
    let saltArray = base64ToBytes(salt);

    let encryptedMainKeyJson = await storageGetItem(ENCRYPTED_MAIN_KEY);
    if (encryptedMainKeyJson == null) {
        throw new Error('storageDecryptMainKey DERIVED_KEY_SALT exists but ENCRYPTED_MAIN_KEY does ont exist.');
    }

    let encryptedMainKey = JSON.parse(encryptedMainKeyJson);
    
    let derivedKey = await cryptoApiScrypt(passphrase, saltArray);
    if (derivedKey == null) {
        throw new Error('storageDecryptMainKey cryptoApiScrypt failed.');
    }

    let derivedKeyArray = base64ToBytes(derivedKey.key);
    let mainKeyBase64 = await cryptoApiDecrypt(derivedKeyArray, encryptedMainKey);
    if (mainKeyBase64 == null) {
        throw new Error('storageDecryptMainKey cryptoApiDecrypt failed.');
    }

    let mainKeyArray = base64ToBytes(mainKeyBase64);
    return mainKeyArray;
}

async function storageDecryptData(passphrase, encryptedDataString) {
    if (typeof encryptedDataString === 'string' || encryptedDataString instanceof String) {

    }
    else {
        throw new Error('storageEncryptData encryptedDataString should be of type string.');
    }

    let mainKeyArray = await storageDecryptMainKey(passphrase);
    if (mainKeyArray == null) {
        throw new Error('storageEncryptData storageDecryptMainKey returned null.');
    }

    let encryptedData = JSON.parse(encryptedDataString);

    let data = await cryptoApiDecrypt(mainKeyArray, encryptedData);
    return data;
}

/*
    Encryption hierarchy: 
        passphrase+salt -> (scrypt) -> derivedKey -> (encrypts) -> mainKey -> (encrypts) -> (other data)

    derivedKey : A key that is derived using scrypt from the passphrase. It is not saved to storage.
    salt : The salt used for creating the derivedKey from the passphrase. The salt is created the first time. It is saved to storage.
    mainKey : An aes key that is created in random. It is created only the first time. This key is used to encrypt all other data. This key is encrypted with the derivedKey and the encrypted key is saved to storage.
*/
async function storageCreateMainKey(passphrase) {
    let salt = await StorageApi.GetItem(DERIVED_KEY_SALT);
    if (salt != null) {
        throw new Error('storageCreateMainKey DERIVED_KEY_SALT already exists.');
    }

    let encryptedMainKeyCheck = await StorageApi.GetItem(ENCRYPTED_MAIN_KEY);
    if (encryptedMainKeyCheck != null) {
        throw new Error('storageCreateMainKey MAIN_KEY already exists.');
    }

    let derivedKey = await cryptoApiScryptAutoSalt(passphrase);
    if (derivedKey == null) {
        throw new Error('storageCreateMainKey cryptoApiScryptAutoSalt failed.');
    }

    let storeSaltResult = await storageSetItem(DERIVED_KEY_SALT, derivedKey.salt);
    if (storeSaltResult != true) {
        throw new Error('storageCreateMainKey storageSetItem DERIVED_KEY_SALT failed.');
    }

    let mainKeyArray = await cryptoNewAesKey();
    let mainKeyBase64 = bytesToBase64(mainKeyArray);
    let derivedKeyArray = base64ToBytes(derivedKey.key);

    let encryptedMainKey = await cryptoApiEncrypt(derivedKeyArray, mainKeyBase64);
    let encryptedMainKeyJson = JSON.stringify(encryptedMainKey);

    let encryptedKeyStoreResult = await storageSetItem(ENCRYPTED_MAIN_KEY, encryptedMainKeyJson);
    if (encryptedKeyStoreResult != true) {
        throw new Error('storageCreateMainKey storageSetItem ENCRYPTED_MAIN_KEY failed.');
    }

    return mainKeyArray;
}

async function storageDoesItemExist(key) {
    if (typeof key === 'string' || key instanceof String) {

    } else {
        throw new Error('storageDoesItemExist key should be of type string.');
    }

    let result = await StorageApi.GetItem(key);
    if (result == null) {
        return false;
    }
    return true;
}

async function storageGetItem(key) {
    if (typeof key === 'string' || key instanceof String) {

    } else {
        throw new Error('storageGetItem key should be of type string.');
    }

    let result = await StorageApi.GetItem(key);
    if (result == null) {
        return null;
    }
    var item = JSON.parse(result);


    let hash = await cryptoHash(key + item.value);
    if (hash != item.hash) {
        throw new Error('storageGetItem mismatched hash.');
    }    

    return item.value;
}

async function storageSetItem(key, value) {
    if (typeof key === 'string' || key instanceof String) {

    } else {
        throw new Error('storageSetItem key should be of type string.');
    }

    if (typeof value === 'string' || value instanceof String) {

    } else {
        throw new Error('storageSetItem value should be of type string.');
    }

    let hash = await cryptoHash(key + value);
    let item = {
        value: value,
        hash: hash
    }
    let ret = await StorageApi.SetItem(key, item);

    let result = await storageGetItem(key);
    if (result == null) {
        throw new Error('storageSetItem null value after save.');
    } else {
        if (value == result) {           
            return true;
        } else {
            throw new Error('storageSetItem mismatched value after save.');
        }        
    }

    return true;
}

async function storageGetSecureItem(passphrase, key) {
    let encryptedValue = await storageGetItem(key);
    if (encryptedValue == null) {
        return null;
    }

    let data = await storageDecryptData(passphrase, encryptedValue);

    return data;
}

async function storageMultiGetSecureItems(passphrase, keyArray) {
    //Decrypt main aes key
    let mainKeyArray = await storageDecryptMainKey(passphrase);
    if (mainKeyArray == null) {
        throw new Error('storageEncryptData storageDecryptMainKey returned null.');
    }

    const dataArray = [];

    //Loop through key list
    for (var i = 0; i < keyArray.length; i++) {
        //Retrieve stored data
        let encryptedDataString = await storageGetItem(keyArray[i]);
        if (encryptedDataString == null) {
            dataArray.push(null);
            continue;
        }

        //Decrypt retrieved data
        let encryptedData = JSON.parse(encryptedDataString);
        let data = await cryptoApiDecrypt(mainKeyArray, encryptedData);
        dataArray.push(data);
    }

    return dataArray;
}

async function storageSetSecureItem(passphrase, key, value) {
    if (typeof key === 'string' || key instanceof String) {

    }
    else {
        throw new Error('storageSetSecureItem key should be of type string.');
    }

    //Decrypt main aes key
    let mainKeyArray = await storageDecryptMainKey(passphrase);
    if (mainKeyArray == null) {
        throw new Error('storageSetSecureItem storageDecryptMainKey returned null.');
    }

    //Encrypt the data
    let encryptedData = await cryptoApiEncrypt(mainKeyArray, value);
    let encryptedDataJson = JSON.stringify(encryptedData);

    //Store encrypted data
    let ret = await storageSetItem(key, encryptedDataJson);
    if (ret != true) {
        return false;
    }

    //Retrieve stored data
    let encryptedDataCheckString = await storageGetItem(key);
    if (encryptedDataCheckString == null) {
        throw new Error('storageSetSecureItem storageGetItem returned null after save.');
    }

    //Decrypt retrieved data
    let encryptedDataCheck = JSON.parse(encryptedDataCheckString);
    let dataCheck = await cryptoApiDecrypt(mainKeyArray, encryptedDataCheck);

    if (dataCheck === value) {
        return true;
    } else {
        throw new Error('storageSetSecureItem data mismatch after save.');
    }    
}
