//get reference to the empty canvas element in index.html, creates constant called ctx
const ctx = document.getElementById('marbleChart');
const barCtx = document.getElementById('marbleBarChart');

//add initial data to chart
const chartData = {
    labels: ['2025-07-19', '2025-07-22', '2025-07-26'], //x axis labels (dates)
    datasets: [ //lines on the graph (players)
        {label: 'Syed', data: [4,4,4], borderColor: '#008080', tension: 0.1 }, //slightly curves the line
        {label: 'George', data: [3,3,3], borderColor: '#cf002dff', tension: 0.1},
        {label: 'Jan', data: [2,4,5], borderColor: '#e98935ff', tension: 0.1},
        {label: 'Parker', data: [1,-1,0], borderColor: '#AE93E5', tension: 0.1},
        {label: 'Jaz', data: [0,0,0], borderColor: '#8b9ad9', tension: 0.1}
    ]
};

//create line chart instance
const marbleChart = new Chart(ctx, { //storing chart in a variable
    type: 'line', //line graph
    data: chartData, //defined above
    options: {
        scales: {
            y: { //number of marbles
                beginAtZero: true,
                grid: {color: 'rgba(255, 255, 255, 0.1)'},
                ticks: { //labels
                    color: '#e0e0e0',
                    precision: 0, //only whole numbers
                    font: {size: 16}
                }
            },
            x: { //date
                beginAtZero: true,
                grid: {color: 'rgba(255, 255, 255, 0.1)'},
                ticks: {color: '#e0e0e0'}
            }
        },
        plugins: {
            legend: { //legend text
                labels: {
                    color: '#e0e0e0'
                }
            }
        }
    }
});

//sort players from most to least marbles, so that bar chart displays this from left to right
let standings = chartData.datasets.map(dataset => { //combines player data into a single array of objects
    return{
        label: dataset.label,
        score: dataset.data[dataset.data.length - 1], //get last entry from player marbles array
        color: dataset.borderColor
    }
});
standings.sort((a,b) => b.score - a.score); //sort the array by score in descending order
const currentStandingsData = {
    labels: standings.map(player => player.label),
    datasets: [{
        label: 'Current Mahble Count',
        data: standings.map(player => player.score),
        backgroundColor: standings.map(player => player.color) //reuse colors from line graph
    }]
};
//create bar chart instance
const marbleBarChart = new Chart(barCtx, {
    type: 'bar',
    data: currentStandingsData,
    options: {
        scales: {
            y: {
                beginAtZero: true,
                grid: {color: 'rgba(255,255,255,0.1)'},
                ticks: {
                    color: '#e0e0e0',
                    precision: 0,
                    font: {size: 16}
                }
            },
            x: {
                grid: {display:false}, //hiding grid lines
                ticks: {
                    color: '#e0e0e0',
                    font: {size: 16}
                }
            }
        },
        plugins: {
            legend: {
                display: false //player names are on x axis, so legend isn't required
            }
        }
    }
});


//BELOW NOT CURRENTLY APPLICABLE ON STATIC PAGE

//event listener for form submission
const form = document.getElementById('add-entry-form'); //create reference to form in html
form.addEventListener('submit', function(event) { //function will run everytime "Update Entry" is clicked (submit button)
    event.preventDefault(); //prevents page from reloading - this normally happens by default when a form is submitted
    const dateInput = document.getElementById('date-input').value; //gets our input elements, .value gets inputted value
    const playerIndex = document.getElementById('player-select').value;
    const marbleCount = parseInt(document.getElementById('marble-input').value); //parseInt makes sure it is treated as a number

    if (playerIndex === "") { //player validation
        alert("Please select a player.");
        return; //stops function
    }

    const dateIndex = marbleChart.data.labels.indexOf(dateInput); //finds if date already exists in graph, does index search of marbleChart.data.labels based on user input, returns position in array

    if(dateIndex !== -1) { //i.e. if the date inputted already exists (it returns a -1 in the array if it does not)
        marbleChart.data.datasets[playerIndex].data[dateIndex] = marbleCount; //in the chart's data, go to datasets array, find the line for correct player, go to that line's data array, find the point for the correct date, set it to new value
    } else { //if date is new
        marbleChart.data.labels.push(dateInput); //add new date to the labels array so it shows on graph

        marbleChart.data.datasets.forEach((dataset, index) => { //updates values
            if (index == playerIndex) { //for new player
                dataset.data.push(marbleCount); //adds new value
            } else {
                const lastValue = dataset.data.length > 0 ? dataset.data[dataset.data.length - 1] : 0; //for all other plays, add their same value for the new date, so the lines on the graph match up
                dataset.data.push(lastValue);
            }
        });
    }

    marbleChart.update(); //redraws graph with new data
    form.reset(); //clears form fields for next entry
});
