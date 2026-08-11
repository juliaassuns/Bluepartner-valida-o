/**
 * validation.js - Funções de validação de dados
 */

/**
 * Valida um CNPJ (Cadastro Nacional da Pessoa Jurídica).
 * 
 * @param {string | number} cnpj O CNPJ para validar. Pode estar formatado ou conter apenas números.
 * @returns {boolean} `true` se o CNPJ for válido, `false` caso contrário.
 */
function validaCnpj(cnpj) {
    const cnpjLimpio = String(cnpj || '').replace(/[^\d]/g, '');

    if (cnpjLimpio.length !== 14) {
        return false;
    }

    // Elimina CNPJs invalidos conhecidos
    if (/^(\d)\1+$/.test(cnpjLimpio)) {
        return false;
    }

    let tamanho = cnpjLimpio.length - 2;
    let numeros = cnpjLimpio.substring(0, tamanho);
    let digitos = cnpjLimpio.substring(tamanho);
    let soma = 0;
    let pos = tamanho - 7;

    for (let i = tamanho; i >= 1; i--) {
        soma += parseInt(numeros.charAt(tamanho - i), 10) * pos--;
        if (pos < 2) {
            pos = 9;
        }
    }

    let resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
    if (resultado !== parseInt(digitos.charAt(0), 10)) {
        return false;
    }

    tamanho = tamanho + 1;
    numeros = cnpjLimpio.substring(0, tamanho);
    soma = 0;
    pos = tamanho - 7;

    for (let i = tamanho; i >= 1; i--) {
        soma += parseInt(numeros.charAt(tamanho - i), 10) * pos--;
        if (pos < 2) {
            pos = 9;
        }
    }

    resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
    if (resultado !== parseInt(digitos.charAt(1), 10)) {
        return false;
    }

    return true;
}

module.exports = {
    validaCnpj,
};
