const dollarFormat = d3.format('$,.0f');

function findFirstPMIDrop(data) {
  for (let row of data) {
    if (row.pmiGoal === 1) { return row.paymentNumber;  }
  }
  return -1; // If PMI never drops
}

function findNextPMIDrop(data) {
  for (let row of data) {
    if (row.pmiMin === 1) { return row.paymentNumber;   }
  }
  return -1; // If PMI never drops
}

function findExtraPayments(data) {
  for (let row of data) {
    if (row.remainingBalanceGoal <= 0) { return row.cumulativeAmountGoal - row.cumulativeAmountMin;   }
  }
  return -1; // If loan never repaid
}

function findInterestSavings(data, numberOfPayments) {
  let interestGoal = 0;
  let interestTotal = 0;
  for (let row of data) {
    if (row.remainingBalanceGoal <= 0) {  interestGoal = row.cumulativeInterestGoal;   }
    if (row.paymentNumber === numberOfPayments) {  interestTotal = row.cumulativeInterestMin;   }
  }
  return interestTotal - interestGoal;
}

function amortizationCalculate() {
  const loanAmount = parseCurrency(d3.select('#loanAmount').property('value'));
  const principal = parseCurrency(d3.select('#principal').property('value'));
  const equity = principal / (loanAmount + principal);
  const interestRate = parseFloat(d3.select('#interestRate').property('value')) / 100;
  const numberOfPayments = parseFloat(d3.select('#paymentsLeft').property('value'));
  const amortizationGoal = parseFloat(d3.select('#amortizationGoal').property('value'));
  const pmiCost = parseFloat(d3.select('#pmi').property('value'));

  // Calculate the minimum monthly payment and the "goal" monthly payment to reach user's payment-based goal
  const minimum = calculateMonthlyPayment(loanAmount, interestRate, numberOfPayments);
  const goal = calculateMonthlyPayment(loanAmount, interestRate, amortizationGoal);
  const difference = goal - minimum;

  // Paint the first round of results in "#written-results"
  d3.select("#min-payment").text(dollarFormat(minimum));
  d3.select("#goal-payment").text(dollarFormat(goal));
  d3.select("#payment-difference").text(dollarFormat(difference));
  d3.select("#written-results").style("visibility","visible").style("opacity","1");

  // Create the scenario df
  const scenario_data = createPaymentPlanDF(loanAmount, interestRate, numberOfPayments, minimum, goal, principal);
  console.log(scenario_data);
  const pmiEarly = findFirstPMIDrop(scenario_data);
  const pmiMaintain = findNextPMIDrop(scenario_data);

  // Paint the next round of results pn the page in "#next-results"
  d3.select("#pmi-early").text(pmiMaintain - pmiEarly + " payments early (" + pmiEarly + " payments vs. " + pmiMaintain + " payments)");
  d3.select("#pmi-savings").text(dollarFormat((pmiMaintain - pmiEarly) * pmiCost));
  d3.select("#interest-savings").text(dollarFormat(findInterestSavings(scenario_data, numberOfPayments)));
  d3.select("#extra-payment").text(dollarFormat(findExtraPayments(scenario_data)));
  d3.selectAll(".goal-payments").text(amortizationGoal);
  d3.select("#next-results").style("visibility","visible").style("opacity","1");

  // Plot the chart and legend
  d3.select("#legend").style("visibility","visible").style("opacity","1");
  drawChart(scenario_data, pmiCost);
  d3.select(".chart-container").style("visibility","visible").style("opacity","1");
  createPaymentPlanTable(scenario_data)
  d3.select("#table-container").style("visibility","visible").style("opacity","1");
  document.getElementById('download-button').addEventListener('click', () => {
    downloadAmortizationSchedule(scenario_data);
  });
}




// Percent form formatting
document.getElementById('interestRate').addEventListener('focus', function (event) {
  event.target.value = event.target.value.replace('%', '');
});
document.getElementById('interestRate').addEventListener('blur', function (event) {
  event.target.value = event.target.value + '%';
});
// Format percent the first time through
document.getElementById('interestRate').value = document.getElementById('interestRate').value + '%';

// Currency form formatting
function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0,  maximumFractionDigits: 0, }).format(value);
}
function parseCurrency(currencyString) {
  const cleanedString = currencyString.replace(/[^0-9.]+/g, '');
  const parsedValue = parseFloat(cleanedString.replace(/[$,]/g, ''));
  return isNaN(parsedValue) ? 0 : parsedValue;
}
document.getElementById('loanAmount').addEventListener('focus', function (event) {
  event.target.value = parseCurrency(event.target.value);
});
document.getElementById('loanAmount').addEventListener('blur', function (event) {
  event.target.value = formatCurrency(event.target.value);
});
document.getElementById('principal').addEventListener('focus', function (event) {
  event.target.value = parseCurrency(event.target.value);
});
document.getElementById('principal').addEventListener('blur', function (event) {
  event.target.value = formatCurrency(event.target.value);
});
// Format currency the first time
document.getElementById('loanAmount').value = formatCurrency(document.getElementById('loanAmount').value);
document.getElementById('principal').value = formatCurrency(document.getElementById('principal').value);

// Use `Required Monthly Payment` = L * (r * (1 + r)^n) / ((1 + r)^n - 1)
//    L is the loan amount
//    r is the monthly interest rate
//    n is the desired number of payments
function calculateMonthlyPayment(loanAmount, interestRate, numberOfPayments) {
  const monthlyInterestRate = interestRate / 12;
  const numerator = monthlyInterestRate * Math.pow((1 + monthlyInterestRate), numberOfPayments);
  const denominator = Math.pow((1 + monthlyInterestRate), numberOfPayments) - 1;
  const monthlyPayment = loanAmount * (numerator / denominator);
  return monthlyPayment;
}

// Iterate through monthly payments to keep track of cumulative payments and interest
function createPaymentPlanDF(loanAmount, interestRate, numberOfPayments, minimum, goal, principal) {
  // Initialize important variables for both routes (min and goal)
  let data = [];
  let [minMonthlyPayment, goalMonthlyPayment] = [minimum, goal];
  let [remainingBalanceMin, remainingBalanceGoal] = [loanAmount, loanAmount];
  let [cumulativePrincipalMin, cumulativePrincipalGoal] = [principal, principal];
  let [cumulativeAmountMin, cumulativeAmountGoal, cumulativeInterestMin, cumulativeInterestGoal] = [0, 0, 0, 0];
  let monthlyInterestRate = interestRate / 12;
  let total = principal + loanAmount;
  let [equityGoal, equityMin] = [principal / total, principal / total];
  let finish_flag = 0;

  // Iterate through each payment month
  for (let i = 1; i <= numberOfPayments; i++) {
    // Calculate cumulative costs for the "minimum" route (minimum payments, normal mortgage)
    let interestMin = remainingBalanceMin * monthlyInterestRate;
    let principalMin = minMonthlyPayment - interestMin;
    cumulativePrincipalMin += principalMin;
    equityMin = cumulativePrincipalMin / total;
    remainingBalanceMin -= principalMin;
    cumulativeAmountMin += minMonthlyPayment;
    cumulativeInterestMin += interestMin;

    // If there is still a remaining balance via the "goal" route, calculate the variables for the "goal" route
    if (remainingBalanceGoal >= 0) {
      let interestGoal = remainingBalanceGoal * monthlyInterestRate;
      let principalGoal = goalMonthlyPayment - interestGoal;
      cumulativePrincipalGoal += principalGoal;
      equityGoal = cumulativePrincipalGoal / total;
      remainingBalanceGoal -= principalGoal;
      cumulativeAmountGoal += goalMonthlyPayment;
      cumulativeInterestGoal += interestGoal;
    } else {
      finish_flag += 1;
    }

    console.log("finish_flag: " + finish_flag);
    
    // Push these calculated variables into a new row of data in the `data` object
    data.push({
      paymentNumber: i,
      cumulativeAmountMin: cumulativeAmountMin,
      remainingBalanceMin: remainingBalanceMin,
      cumulativeInterestMin: cumulativeInterestMin,
      equityMin: equityMin,
      pmiMin: equityMin >= .2 ? 1 : NaN,                // Flag if the min route's equity is greater than or equal to 20%
      cumulativeAmountGoal: finish_flag < 1 ? cumulativeAmountGoal : NaN ,
      remainingBalanceGoal: finish_flag < 1 ? remainingBalanceGoal : NaN,
      cumulativeInterestGoal: finish_flag < 1 ? cumulativeInterestGoal : NaN,
      equityGoal: finish_flag < 1 ? equityGoal : NaN,
      pmiGoal: equityGoal >= .2 ? 1 : NaN,              // Flag if the goal route's equity is greater than or equal to 20%
    });
  }

  return data;
}

function drawChart(data, pmiCost) {
  // Remove the old chart if it exists
  d3.selectAll("svg").remove();
  // Remove the old y-axis if it exists
  d3.select(".y-axis").remove();
  // Define margins for the chart
  const margin = { top: 30, right: 30, bottom: 50, left: 50 };
  // Calculate the width and height of the chart area
  const width = 1000;// - margin.left - margin.right;
  const height = 500;// - margin.top - margin.bottom;

  // Create the x scale
  const x = d3.scaleLinear()
    .domain([1, data.length])
    .range([0, width]);

  // Create the y scale
  let y = d3.scaleLinear()
    .domain([0, d3.max(data, d => Math.max(
      d3.max(data, d => d.remainingBalanceMin),
      d3.max(data, d => d.remainingBalanceGoal),
      d3.max(data, d => d.cumulativeInterestMin),
      d3.max(data, d => d.cumulativeInterestGoal)))])
    .range([height, 0]);

  // Create the x-axis
  const xAxis = d3.axisBottom(x);
  // Create the y-axis
  const yAxis = d3.axisLeft(y).tickFormat(dollarFormat);

  const pmiCutoffIndexMin = data.findIndex(d => d.equityMin >= 0.2);
  const pmiCutoffIndexGoal = data.findIndex(d => d.equityGoal >= 0.2);

  // Add in tooltip
  const pmitooltip = d3.select("#pmitooltip");
  
  // Helper function to format the tooltip content
  function formatPMITooltipContent(d, numberOfPayments, pmi, color) {
    return `<span class="fs-6 lh-lg fw-light opacity-75">Reaches 20% equity in </span><span class="fw-bold" style="color: ${color};">${numberOfPayments}</span><span class="fs-6 lh-lg fw-light opacity-75"> payments</span>
            <br/>
            <span class="fs-6 lh-lg fw-light opacity-75">PMI paid: </span><span class="fw-light" style="color: ${color};">${dollarFormat(numberOfPayments * pmi)}</span>`;
  }

  // Helper function to show the tooltip
  function showPMITooltip(event, d, numberOfPayments, pmi, color) {
    //const [x, y] = d3.pointer(event);
    //const svgRect = svg.node().getBoundingClientRect();
    console.log(event.clientY);
    pmitooltip.html(formatPMITooltipContent(d, numberOfPayments, pmi, color))
      .style("left", (event.clientX + 15) + "px")
      .style("top", (event.clientY + window.scrollY - 10) + "px")
      .style("display", "block")
      .style("z-index", 50)
      .style("opacity", 0)
      .transition()
      .duration(200)
      .style("opacity", 1);
  }

  // Helper function to hide the tooltip
  function hidePMITooltip() {
    pmitooltip.transition()
      .duration(200)
      .style("opacity", 0)
      .on("end", () => pmitooltip.style("display", "none"));
  }

  // Create the SVG container and set its dimensions
  const svg = d3.select("#chart")
    .append("svg")
    .attr("width", "100%") // Set the width to 100% of the parent container
    .attr("height", height - 60)
    .attr("viewBox", `0 0 ${width} ${height}`) // Define the viewBox dimensions
    .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`); // Maintain aspect ratio when scaling

  // Draw the vertical line for the minimum payment scenario
  if (pmiCutoffIndexMin !== -1) {
    svg.append('rect')
      .attr('width', x(pmiCutoffIndexMin + 1)) // Add 1 because x scale starts at 1
      .attr('x', 0)
      .attr('height', height  - y(pmiCost * (pmiCutoffIndexMin + 1)))
      .attr('y', y(pmiCost * (pmiCutoffIndexMin + 1)))
      .attr('stroke', '#FFA07A')
      .attr('fill', '#FFFFFF')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3')
      .attr('z-index', -10)
      .on("mouseover", (event, d) => {
        showPMITooltip(event, d, pmiCutoffIndexMin, pmiCost, '#FFA07A');
      })
      .on("mouseout", hidePMITooltip);
  }

  // Draw the vertical line for the extra payment scenario
  if (pmiCutoffIndexGoal !== -1) {
    svg.append('rect')
      .attr('width', x(pmiCutoffIndexGoal + 1)) // Add 1 because x scale starts at 1
      .attr('x', 0)
      .attr('height', height - y(pmiCost * (pmiCutoffIndexGoal + 1)))
      .attr('y', y(pmiCost * (pmiCutoffIndexGoal + 1)))
      .attr('stroke', '#8ED4B4')
      .attr('fill', '#FFFFFF')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3')
      .attr('z-index', -10)
      .on("mouseover", (event, d) => {
        showPMITooltip(event, d, pmiCutoffIndexGoal, pmiCost, '#8ED4B4');
      })
      .on("mouseout", hidePMITooltip);
  }

  // Add the x-axis to the SVG
  svg.append("g")
    .attr("transform", `translate(0,${height})`)
    .style("color","#6c757d")
    .call(xAxis);

  // Add the y-axis to the SVG
  svg.append("g")
    .attr("class", "y-axis")
    .style("color","#6c757d")
    .call(yAxis);


  // Create a color object
  const color = {
    "Minimum Remaining Balance": "#ff856f",
    "Minimum Interest Paid": "#FFA07A",
    "Goal Remaining Balance": "#5CC085",
    "Goal Interest Paid": "#8ED4B4"
  };

  // Add the tooltip element
  const tooltip = d3.select("#tooltip");

  // Helper function to format the tooltip content
  function formatTooltipContent(d, seriesName, value) {
    const valueLabel = seriesName.includes('Balance') ? 'Remaining balance:' : 'Interest paid:';
    const styleColor = color[seriesName];
    console.log(seriesName);
    return `<span class="fs-6 lh-lg fw-bold opacity-50">${seriesName}</span>
            <br/>
            <span class="fs-6 lh-lg fw-light opacity-75">Payment Number: </span><span class="fw-bold" style="color: ${styleColor};">${d.paymentNumber}</span>
            <br/>
            <span class="fs-6 lh-lg fw-light opacity-75">${valueLabel}: </span><span class="fw-bold" style="color: ${styleColor};">${dollarFormat(value)}</span>`;
  }

  // Helper function to show the tooltip
  function showTooltip(event, d, seriesName, value) {
    //const [x, y] = d3.pointer(event);
    //const svgRect = svg.node().getBoundingClientRect();
    console.log(event.clientY);
    tooltip.html(formatTooltipContent(d, seriesName, value))
      .style("left", (event.clientX + 15) + "px")
      .style("top", (event.clientY + window.scrollY - 10) + "px")
      .style("display", "block")
      .style("z-index", 50)
      .style("opacity", 0)
      .transition()
      .duration(200)
      .style("opacity", 1);
  }

  // Helper function to hide the tooltip
  function hideTooltip() {
    tooltip.transition()
      .duration(200)
      .style("opacity", 0)
      .on("end", () => tooltip.style("display", "none"));
  }

  // Create a line generator for each series
  const lineMinRemainingBalance = d3.line()
    .x(d => x(d.paymentNumber))
    .y(d => y(d.remainingBalanceMin));

  const lineMinInterestPaid = d3.line()
    .x(d => x(d.paymentNumber))
    .y(d => y(d.cumulativeInterestMin));

  const lineGoalRemainingBalance = d3.line()
    .defined(d => !isNaN(d.remainingBalanceGoal))
    .x(d => x(d.paymentNumber))
    .y(d => y(d.remainingBalanceGoal));

  const lineGoalInterestPaid = d3.line()
    .defined(d => !isNaN(d.cumulativeInterestGoal))
    .x(d => x(d.paymentNumber))
    .y(d => y(d.cumulativeInterestGoal));

  // Plot the lines
  svg.append("path")
    .datum(data)
    .attr("fill", "none")
    .attr("stroke", color["Minimum Remaining Balance"])
    .attr("stroke-width", 2)
    .attr("d", lineMinRemainingBalance)
    .attr("data-series-name", "Minimum Remaining Balance");

  svg.append("path")
    .datum(data)
    .attr("fill", "none")
    .attr("stroke", color["Minimum Interest Paid"])
    .attr("stroke-width", 2)
    .attr("d", lineMinInterestPaid)
    .attr("data-series-name", "Minimum Interest Paid");

  svg.append("path")
    .datum(data)
    .attr("fill", "none")
    .attr("stroke", color["Goal Remaining Balance"])
    .attr("stroke-width", 2)
    .attr("d", lineGoalRemainingBalance)
    .attr("data-series-name", "Goal Remaining Balance");

  svg.append("path")
    .datum(data)
    .attr("fill", "none")
    .attr("stroke", color["Goal Interest Paid"])
    .attr("stroke-width", 2)
    .attr("d", lineGoalInterestPaid)
    .attr("data-series-name", "Goal Interest Paid");

  // Add circles for Minimum Payment Remaining Balance series
  svg.selectAll("circle.minRemainingBalance")
    .data(data)
    .enter()
    .append("circle")
    .attr("class", "minRemainingBalance")
    .attr("cx", d => x(d.paymentNumber))
    .attr("cy", d => y(d.remainingBalanceMin))
    .attr("r", 3)
    .attr("fill", color["Minimum Remaining Balance"])
    .attr("data-series-name", "Minimum Remaining Balance")
    .attr("value",d => d.remainingBalanceMin);

  // Add circles for Minimum Payment Interest Paid series
  svg.selectAll("circle.minInterestPaid")
    .data(data)
    .enter()
    .append("circle")
    .attr("class", "minInterestPaid")
    .attr("cx", d => x(d.paymentNumber))
    .attr("cy", d => y(d.cumulativeInterestMin))
    .attr("r", 3)
    .attr("fill", color["Minimum Interest Paid"])
    .attr("data-series-name", "Minimum Interest Paid")
    .attr("value",d => d.cumulativeInterestMin);

  // Add circles for Goal Payment Remaining Balance series
  svg.selectAll("circle.goalRemainingBalance")
    .data(data.filter(d => !isNaN(d.remainingBalanceGoal)))
    .enter()
    .append("circle")
    .attr("class", "goalRemainingBalance")
    .attr("cx", d => x(d.paymentNumber))
    .attr("cy", d => y(d.remainingBalanceGoal))
    .attr("r", 3)
    .attr("fill", color["Goal Remaining Balance"])
    .attr("data-series-name", "Goal Remaining Balance")
    .attr("value",d => d.remainingBalanceGoal);

  // Add circles for Goal Payment Interest Paid series
  svg.selectAll("circle.goalInterestPaid")
    .data(data.filter(d => !isNaN(d.cumulativeInterestGoal)))
    .enter()
    .append("circle")
    .attr("class", "goalInterestPaid")
    .attr("cx", d => x(d.paymentNumber))
    .attr("cy", d => y(d.cumulativeInterestGoal))
    .attr("r", 3)
    .attr("fill", color["Goal Interest Paid"])
    .attr("data-series-name", "Goal Interest Paid")
    .attr("value",d => d.cumulativeInterestGoal);


  // Add event listeners to the lines
  svg.selectAll("circle")
    .on("mouseover", (event, d) => {
      const seriesName = d3.select(event.target).attr("data-series-name");
      const value = d3.select(event.target).attr("value");
      showTooltip(event, d, seriesName, value);
    })
    .on("mouseout", hideTooltip);
}

function renderCurrency(data, type, row) {
  if (type === "display" || type === "filter") {
    // Use the Intl.NumberFormat object to format the number as currency with commas
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });

    return formatter.format(data);
  }
  return data; // Return the raw data for other types (e.g., sorting)
}

function renderPercent(data, type, row) {
  if (type === "display" || type === "filter") {
    // Format the number as a percentage with two decimal places
    const formattedPercent = (data * 100).toFixed(1) + "%";
    return formattedPercent;
  }
  return data; // Return the raw data for other types (e.g., sorting)
}


function createPaymentPlanTable(data) {
  // If the table has been previously initialized, destroy the old instance
  if ($.fn.DataTable.isDataTable("#payment-plan-table")) {
    $("#payment-plan-table").DataTable().destroy();
  }

  // Remove the old table body
  $("#payment-plan-table tbody").remove();

  // Create a new table body and append it to the table
  let tbody = $("<tbody></tbody>");
  $("#payment-plan-table").append(tbody);

  // Get the table body element
  const tableBody = document.querySelector("#payment-plan-table tbody");

  // Clear the table body
  tableBody.innerHTML = '';

  // Populate the table with data
  data.forEach(d => {
    const row = tableBody.insertRow(); 

    row.insertCell().innerText = d.paymentNumber;
    row.insertCell().innerText = d.cumulativeAmountMin.toFixed(0);
    row.insertCell().innerText = d.remainingBalanceMin.toFixed(0);
    row.insertCell().innerText = d.cumulativeInterestMin.toFixed(0);
    row.insertCell().innerText = d.equityMin.toFixed(3);
    row.insertCell().innerText = isNaN(d.cumulativeAmountGoal) ? '' : d.cumulativeAmountGoal.toFixed(0);
    row.insertCell().innerText = isNaN(d.remainingBalanceGoal) ? '' : d.remainingBalanceGoal.toFixed(0);
    row.insertCell().innerText = isNaN(d.cumulativeInterestGoal) ? '' : d.cumulativeInterestGoal.toFixed(0);
    row.insertCell().innerText = isNaN(d.equityGoal) ? '' : d.equityGoal.toFixed(3);
  });

  // Initialize the DataTable plugin
  $('#payment-plan-table').DataTable({
    pageLength: 12,
    lengthMenu: [
      [12, 24, 48, -1], // The values for the dropdown menu
      [12, 24, 48, 'All'] // The display text for each value
    ],
    searching: false,
    order: [[0, 'asc']], // Sort by Payment Number column ascending by default
    columnDefs: [
      { targets: [1, 2, 3, 5, 6, 7], render: renderCurrency }, // Apply the renderCurrency function to the specified columns
      { targets: [4, 8], render: renderPercent}
    ]
  });
}

function downloadAmortizationSchedule(data) {
  // Convert the data to CSV format
  const csvContent = dataToCSV(data);

  // Create a Blob with the CSV content
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

  // Create a temporary link element
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'amortization_schedule.csv';

  // Append the link to the DOM, click it, and remove it
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function dataToCSV(data) {
  const headers = [
    'Payment Number',
    'Min Payment Scenario - Cumulative Payments',
    'Min Payment Scenario - Remaining Balance',
    'Min Payment Scenario - Cumulative Interest Paid',
    'Min Payment Scenario - Equity (%)',
    'Goal Payment Scenario - Cumulative Payments',
    'Goal Payment Scenario - Remaining Balance',
    'Goal Payment Scenario - Cumulative Interest Paid',
    'Goal Payment Scenario - Equity (%)'
  ];

  const rows = data.map((d, i) => [
    d.paymentNumber,
    d.cumulativeAmountMin.toFixed(0),
    d.remainingBalanceMin.toFixed(0),
    d.cumulativeInterestMin.toFixed(0),
    d.equityMin.toFixed(3),
    isNaN(d.cumulativeAmountGoal) ? '' : d.cumulativeAmountGoal.toFixed(0),
    isNaN(d.remainingBalanceGoal) ? '' : d.remainingBalanceGoal.toFixed(0),
    isNaN(d.cumulativeInterestGoal) ? '' : d.cumulativeInterestGoal.toFixed(0),
    isNaN(d.equityGoal) ? '' : d.equityGoal.toFixed(3)
  ]);

  const csvContent =
    headers.join(',') + '\n' + rows.map(row => row.join(',')).join('\n');

  return csvContent;
}
