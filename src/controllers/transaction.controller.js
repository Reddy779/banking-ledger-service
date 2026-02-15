const transactionModel = require("../models/transaction.model");
const ledgerModel = require("../models/ledger.model");
const accountModel = require("../models/account.model");
const emailService = require("../services/email.service");
const mongoose = require("mongoose");

/**
 * - Create a new transaction
 * THE 10-STEP TRANSFER FLOW:
     * 1. Validate request
     * 2. Validate idempotency key
     * 3. Check account status
     * 4. Derive sender balance from ledger
     * 5. Create transaction (PENDING)
     * 6. Create DEBIT ledger entry
     * 7. Create CREDIT ledger entry
     * 8. Mark transaction COMPLETED
     * 9. Commit MongoDB session
     * 10. Send email notification
 */



async function createTransaction(req, res) {

    /** 
     * 1. Validate request
    */

    const { fromAccount, toAccount, amount, indempotencyKey } = req.body

    if (!fromAccount || !toAccount || !amount || !indempotencyKey) {
        return res.status(400).json({
            message: "FromAccount, ToAccount, Amount and idempotencyKey are required"
        })
    }

    const fromUserAccount = await accountModel.findOne({
        _id: fromAccount,
    })

    const toUserAccount = await accountModel.findOne({
        _id: toAccount,
    })

    if (!fromUserAccount || !toUserAccount) {
        return res.status(400).json({
            message: "Invalid fromAccount or toAccount"
        })
    }

    /**
     * 2. Validate idempotency key
     */

    const isTranscationAlreadyExists = await transactionModel.findOne({
        idempotencyKey: idempotencyKey
    })

    if (isTranscationAlreadyExists) {
        if (isTranscationAlreadyExists.status === "COMPLETED") {
            return res.status(200).json({
                message: "Transaction already processed",
                transaction: isTranscationAlreadyExists
            })
        }

        if (isTranscationAlreadyExists.status === "PENDING") {
            return res.status(200).json({
                message: "Transaction is still processing",
            })
        }
        if (isTranscationAlreadyExists.status === "FAILED") {
            return res.status(500).json({
                message: "Trnsaction processing failed, Please retry"
            })
        }
        if (isTranscationAlreadyExists.status === "REVERSED") {
            return res.status(500).json({
                message: "Transaction was reversed, please retry"
            })
        }
    }

    /**
     * 3. Check account status
     */

    if (fromUserAccount.status != "ACTIVE" || toUserAccount.status != "ACTIVE") {
        return res.status(400).json({
            message: "Both fromAccount and toAccount must be ACTIVE to process transaction"
        })
    }

    /**
     * 4. Derive sender balance from ledger
     */

    const balance = await fromUserAccount.getBalance()

    if (balance < amount) {
        return res.status(400).json({
            message: `Insufficient balance. Currrent Balance is ${balance}. Requested amount is ${amount}`
        })
    }

    /**
     * 5. Create transaction (PENDING)
     */

    const session = await mongoose.startSession()
    session.startTransaction()


    const transaction = await transactionModel.create({
        fromAccount,
        toAccount,
        amount,
        indempotencyKey,
        status: "PENDING"
    }, { session })

    const debitLedgerEntry = await ledgerModel.create({

        account: fromAccount,
        amount: amount,
        transaction: transaction._id,
        type: "DEBIT"
    }, { session })

    const creditLedgerEntry = await ledgerModel.create({

        account: toAccount,
        amount: amount,
        transaction: transaction._id,
        type: "CREDIT"
    }, { session })

    transaction.status = "COMPLETED"
    await transaction.save({ session })


    await session.commitTransaction()
    session.endSession()

    /**
     * 10. Send email notification
     */

    await emailService.sendTransactionEmail(req.user.email, req.user.name, amount, toAccount._id)

    return res.status(201).json({
        message: "Transaction completed successfully",
        transaction: transaction
    })

}

module.exports = {
    createTransaction
}
