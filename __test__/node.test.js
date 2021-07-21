require("../dist/needlework")

function someHeavyFunction(numberOne, numberTwo) {
    const start = Date.now()
    while (start + 500 > Date.now()) { }
    return numberOne + numberTwo
}
console.time("Threaded Work")
const promises = []
for (let i = 0; i < 200; i++) {
    promises.push(someHeavyFunction.runThread(i, i).then(result => {
        console.log("Thread Completed: " + i)
    }))
}
Promise.all(promises).then(() => {
    console.timeEnd("Threaded Work")
})