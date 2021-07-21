require("../needlework")

function someHeavyFunction(numberOne, numberTwo) {
    const start = Date.now()
    while (start + 500 > Date.now()) { }
    return numberOne + numberTwo
}
console.time("Sync Work")
for (let i = 0; i < 200; i++) {
    someHeavyFunction()
    console.log("Iteration Completed: " + i)
}
console.timeEnd("Sync Work")
