//get reference to the empty canvas element in index.html, creates constant called ctx
const ctx = document.getElementById('marbleChart');

//add initial data to chart
const initialData = {
    labels: ['2025-07-21', '2025-07-28'], //x axis labels (dates)

    datasets: [ //lines on the graph (players)
        {
            label: 'Syed',
            data: [4,4],
            borderColor: '#36a2eb', //blue
            tension: 0.1 //slightly curves the line
        },
        {
            label: 'George',
            data: [3,3],
            borderColor: '#ff6384', //red
            tension: 0.1
        },
        {
            label: 'Jan',
            data: [2,3],
            borderColor: '#4bc0c0', //teal
            tension: 0.1
        },
        {
            label: 'Parker',
            data: [1,0],
            borderColor: '#ffcd56', //yellow
            tension: 0.1
        },
    ]
};

//create chart instance
const marbleChart = new Chart(ctx, { //storing chart in a variable
    type: 'line', //line graph
    data: initialData, //defined above
    options: {
        scales: {
            y: { //number of marbles
                beginAtZero: true,
                grid: {
                    color: 'rgba(255, 255, 255, 0.1)'
                },
                ticks: { //labels
                    color: '#e0e0e0'
                }
            },
            x: { //number of marbles
                beginAtZero: true,
                grid: {
                    color: 'rgba(255, 255, 255, 0.1)'
                },
                ticks: { //labels
                    color: '#e0e0e0'
                }
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
